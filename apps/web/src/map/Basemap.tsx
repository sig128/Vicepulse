import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { GTADB_OVERVIEW, gtadbTileGameRect, gtadbTileInRange, GTADB } from "@vicepulse/shared";
import { CROP_GAME, LEGEND_CLIP, S, screenToGround, view } from "./geo.ts";
import { createRasterMaterial, rasterGlobals } from "./rasterMaterial.ts";
import { useReadiness } from "../lib/readiness.ts";

const OV = GTADB_OVERVIEW;

/** Set from the live renderer's capabilities; tilted views need high anisotropy to stay sharp toward the horizon. */
export const textureQuality = { anisotropy: 4 };

function prepTexture(t: THREE.Texture) {
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = textureQuality.anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const OVERVIEW_URL = "/generated/yanis16-overview.png";

/** Live tile-streaming state for small, local loading indicators (not the entrance overlay). */
export const tileActivity = { inflight: 0 };

export function Overview() {
  const tex = useLoader(THREE.TextureLoader, OVERVIEW_URL);
  const gl = useThree((s) => s.gl);
  const { geometry, material } = useMemo(() => {
    textureQuality.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());
    prepTexture(tex);
    const c = OV.crop;
    const uv = new THREE.Vector4(c.x / OV.width, 1 - (c.y + c.height) / OV.height, c.width / OV.width, c.height / OV.height);
    const m = createRasterMaterial(tex, uv);
    rasterGlobals.materials.add(m);
    const w = (CROP_GAME.maxX - CROP_GAME.minX) * S, h = (CROP_GAME.maxY - CROP_GAME.minY) * S;
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2);
    g.translate(((CROP_GAME.minX + CROP_GAME.maxX) / 2) * S, 0, (-(CROP_GAME.minY + CROP_GAME.maxY) / 2) * S);
    return { geometry: g, material: m };
  }, [tex, gl]);
  useEffect(() => () => { rasterGlobals.materials.delete(material); material.dispose(); geometry.dispose(); }, [material, geometry]);
  useEffect(() => { useReadiness.getState().mark("overview"); }, []);
  return <mesh geometry={geometry} material={material} renderOrder={0} frustumCulled={false} />;
}

type TileEntry = { key: string; z: number; mesh: THREE.Mesh | null; status: "loading" | "ready" | "missing"; used: number; fails: number; retryAt: number };

const MAX_TEXTURES = 420;
const MAX_INFLIGHT = 8;
const FINE_BUDGET = 220, COARSE_BUDGET = 90;
const tileGeom = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Visible ground rectangle in game units (perspective rays above the horizon are skipped), limited to `reach` × span around the target. */
function visibleGameRect(reach = 2.2) {
  const pts: [number, number][] = [];
  const W = view.width, H = view.height;
  for (const [fx, fy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1], [0.5, 0.5]]) {
    const g = screenToGround(fx * W, fy * H);
    if (g) pts.push([g.x / S, -g.z / S]);
  }
  if (!pts.length) return null;
  const lim = (view.span / S) * reach;
  const cx = view.target.x / S, cy = -view.target.y / S;
  const xs = pts.map((p) => Math.min(cx + lim, Math.max(cx - lim, p[0])));
  const ys = pts.map((p) => Math.min(cy + lim, Math.max(cy - lim, p[1])));
  return { minX: Math.max(CROP_GAME.minX, Math.min(...xs)), maxX: Math.min(LEGEND_CLIP.minX + 4096, Math.max(...xs)), minY: Math.max(CROP_GAME.minY, Math.min(...ys)), maxY: Math.min(CROP_GAME.maxY, Math.max(...ys)) };
}

export type WantedTile = { z: number; x: number; y: number; key: string };

type Rect = { minX: number; maxX: number; minY: number; maxY: number };

/** Tiles of the finest level ≤ z that covers `rect` within `budget` tiles. */
function tilesFor(rect: Rect, z: number, budget: number): WantedTile[] {
  for (; z >= 1; z--) {
    const span = GTADB.tileSize / ((1024 * 2 ** z) / GTADB.mapW);
    const x0 = Math.floor((rect.minX + GTADB.zeroX) / span), x1 = Math.floor((rect.maxX + GTADB.zeroX) / span);
    const y0 = Math.floor((GTADB.zeroY - rect.maxY) / span), y1 = Math.floor((GTADB.zeroY - rect.minY) / span);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > budget) continue;
    const out: WantedTile[] = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!gtadbTileInRange(z, tx, ty)) continue;
      const r = gtadbTileGameRect(z, tx, ty);
      if (r.minX >= LEGEND_CLIP.minX && r.minY >= LEGEND_CLIP.minY) continue;
      out.push({ z, x: tx, y: ty, key: `${z}/${tx}/${ty}` });
    }
    return out;
  }
  return [];
}

/** Device-pixel-matched source level for the current zoom: rounding keeps upscaling ≤ √2 without doubling the tile count. */
export function idealZoom(maxZoom = 6) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.max(1, Math.min(maxZoom, Math.round(Math.log2(view.ppu * dpr * 32))));
}

/**
 * Two tiers: the area around the camera target at full detail, plus a coarser far field
 * (only differs in tilted Afterdark views, where the horizon covers far more ground).
 * The first element is always from the fine tier; sorted nearest-to-centre.
 */
export function wantedTiles(maxZoom = 6): WantedTile[] | null {
  const far = visibleGameRect(2.2);
  if (!far || far.minX >= far.maxX || far.minY >= far.maxY) return null;
  const near = visibleGameRect(0.75) ?? far;
  const z = idealZoom(maxZoom);
  const fine = tilesFor(near, z, FINE_BUDGET);
  const fineZ = fine[0]?.z ?? z;
  const coarse = tilesFor(far, Math.max(1, fineZ - 2), COARSE_BUDGET);
  const cx = view.target.x / S, cy = -view.target.y / S;
  const dist = (w: WantedTile) => { const r = gtadbTileGameRect(w.z, w.x, w.y); return Math.hypot((r.minX + r.maxX) / 2 - cx, (r.minY + r.maxY) / 2 - cy); };
  return [...fine.sort((a, b) => dist(a) - dist(b)), ...coarse.sort((a, b) => dist(a) - dist(b))];
}

export function Tiles({ maxZoom = 6 }: { maxZoom?: number }) {
  const group = useRef<THREE.Group>(null!);
  const cache = useRef(new Map<string, TileEntry>());
  const inflight = useRef(0);
  const last = useRef({ t: 0, key: "" });
  const loader = useMemo(() => new THREE.TextureLoader(), []);

  // Retry: failed tiles become eligible again immediately instead of waiting out their backoff.
  useEffect(() => useReadiness.subscribe((s, prev) => {
    if (s.attempt === prev.attempt) return;
    for (const e of cache.current.values()) if (e.status === "missing") { e.retryAt = 0; e.fails = 0; }
  }), []);

  useEffect(() => () => {
    for (const e of cache.current.values()) if (e.mesh) { (e.mesh.material as THREE.ShaderMaterial).uniforms.map.value.dispose(); (e.mesh.material as THREE.Material).dispose(); rasterGlobals.materials.delete(e.mesh.material as THREE.ShaderMaterial); }
    cache.current.clear();
  }, []);

  useFrame(() => {
    const now = performance.now();
    if (now - last.current.t < 120) return;
    last.current.t = now;
    const wanted = wantedTiles(maxZoom);
    if (!wanted) return;
    const curZ = wanted[0]?.z ?? 0;
    const wantedKeys = new Set(wanted.map((w) => w.key));
    for (const w of wanted) {
      const e = cache.current.get(w.key);
      if (e && !(e.status === "missing" && now > e.retryAt)) { e.used = now; continue; }
      if (inflight.current >= MAX_INFLIGHT) continue;
      const entry: TileEntry = { key: w.key, z: w.z, mesh: null, status: "loading", used: now, fails: e?.fails ?? 0, retryAt: 0 };
      cache.current.set(w.key, entry);
      inflight.current++;
      loader.load(`/tiles/yanis16/${w.z}/${w.x}/${w.y}.jpg`, (tex) => {
        inflight.current--;
        prepTexture(tex);
        const r = gtadbTileGameRect(w.z, w.x, w.y);
        const m = createRasterMaterial(tex);
        m.uniforms.uMode.value = rasterGlobals.mode;
        m.uniforms.uAccent.value = rasterGlobals.accent;
        rasterGlobals.materials.add(m);
        const mesh = new THREE.Mesh(tileGeom, m);
        mesh.scale.set((r.maxX - r.minX) * S, 1, (r.maxY - r.minY) * S);
        mesh.position.set(((r.minX + r.maxX) / 2) * S, 0, (-(r.minY + r.maxY) / 2) * S);
        mesh.renderOrder = w.z;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        entry.mesh = mesh;
        entry.status = "ready";
        group.current?.add(mesh);
      }, undefined, () => {
        // Coarser levels keep covering the area; retry with backoff so a transient miss never becomes a permanent hole.
        inflight.current--; entry.status = "missing"; entry.fails++;
        entry.retryAt = performance.now() + Math.min(300_000, 5_000 * 2 ** entry.fails);
      });
    }
    tileActivity.inflight = inflight.current;
    // Entrance readiness: the first view counts as ready once every fine-tier tile has settled.
    const rd = useReadiness.getState();
    if (!rd.done.view && view.width > 1) {
      const fine = wanted.filter((w) => w.z === curZ).map((w) => cache.current.get(w.key));
      if (fine.length && fine.every((e) => e && e.status !== "loading")) {
        if (fine.every((e) => e!.status === "missing")) rd.fail("view", "tiles");
        else rd.mark("view");
      }
    }
    // Lower levels stay visible underneath as a fallback while the current level streams in.
    for (const e of cache.current.values()) {
      if (e.mesh) e.mesh.visible = curZ > 0 && e.z <= curZ;
    }
    // LRU eviction
    const ready = [...cache.current.values()].filter((e) => e.mesh);
    if (ready.length > MAX_TEXTURES) {
      ready.sort((a, b) => a.used - b.used);
      for (const e of ready.slice(0, ready.length - MAX_TEXTURES)) {
        if (wantedKeys.has(e.key)) continue;
        const m = e.mesh!.material as THREE.ShaderMaterial;
        group.current.remove(e.mesh!);
        m.uniforms.map.value.dispose();
        m.dispose();
        rasterGlobals.materials.delete(m);
        cache.current.delete(e.key);
      }
    }
  });

  return <group ref={group} />;
}

/**
 * Primary-reference comparison: State of Leonida YANIS v16.0 z2 tiles from the local cache only
 * (never redistributed; absent in a fresh clone). CRS: west -17000, north 11000, 16 units/px at z2.
 */
export function SolCompare({ opacity }: { opacity: number }) {
  const group = useRef<THREE.Group>(null!);
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const span = 256 * 16;
    const meshes: THREE.Mesh[] = [];
    for (let x = 0; x < 6; x++) for (let y = 0; y < 5; y++) {
      loader.load(`/tiles/sol-v16/2/${x}/${y}.png`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthTest: false, depthWrite: false });
        mats.current.push(m);
        const mesh = new THREE.Mesh(tileGeom, m);
        const minX = -17000 + x * span, maxY = 11000 - y * span;
        mesh.scale.set(span * S, 1, span * S);
        mesh.position.set((minX + span / 2) * S, 0.005, -(maxY - span / 2) * S);
        mesh.renderOrder = 10;
        meshes.push(mesh);
        group.current?.add(mesh);
      }, undefined, () => {});
    }
    return () => { for (const m of meshes) { (m.material as THREE.MeshBasicMaterial).map?.dispose(); (m.material as THREE.Material).dispose(); } mats.current = []; };
  }, []);
  useEffect(() => { for (const m of mats.current) m.opacity = opacity; }, [opacity]);
  return <group ref={group} />;
}

/** Animates every raster material between Atlas and Afterdark colouring. */
export function RasterModeDriver({ mode, accent, reduced }: { mode: "atlas" | "afterdark"; accent: number; reduced: boolean }) {
  rasterGlobals.targetMode = mode === "afterdark" ? 1 : 0;
  rasterGlobals.accent = accent;
  useFrame((_, dt) => {
    const g = rasterGlobals;
    g.mode = reduced ? g.targetMode : g.mode + (g.targetMode - g.mode) * (1 - Math.exp(-dt * 6));
    if (Math.abs(g.mode - g.targetMode) < 0.002) g.mode = g.targetMode;
    for (const m of g.materials) { m.uniforms.uMode.value = g.mode; m.uniforms.uAccent.value = g.accent; }
  });
  return null;
}
