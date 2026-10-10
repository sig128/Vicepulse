import { useEffect, useRef } from "react";
import * as THREE from "three";
import { headingVector } from "@vicepulse/shared";
import { GTADB_OVERVIEW, gtadbTileGameRect } from "@vicepulse/shared";
import { atlasIndex, useStore } from "../lib/store.ts";
import { CROP_GAME, gameToScreen, view } from "./geo.ts";
import { OVERVIEW_URL, wantedTiles } from "./Basemap.tsx";
import { useReadiness } from "../lib/readiness.ts";
import { rig } from "./rig.ts";
import { markers, markerColor, updateClusters, applyFilter } from "./markers.ts";
import { actorDisplay, ACTOR_COLORS, shapePoints, stepActorDisplay } from "./Overlays3D.tsx";
import type { XY } from "../lib/types.ts";

type Tile2D = { img: HTMLImageElement; z: number; rect: ReturnType<typeof gtadbTileGameRect>; ok: boolean; used: number };
const tiles2d = new Map<string, Tile2D>();
let inflight2d = 0;
let lastPick = 0;
let currentZ = 0;

function drawTiles(ctx: CanvasRenderingContext2D, now: number) {
  if (now - lastPick > 150) {
    lastPick = now;
    const wanted = wantedTiles();
    if (wanted) {
      currentZ = wanted[0]?.z ?? 0;
      for (const w of wanted) {
        const e = tiles2d.get(w.key);
        if (e) { e.used = now; continue; }
        if (inflight2d >= 6) continue;
        const img = new Image();
        const entry: Tile2D = { img, z: w.z, rect: gtadbTileGameRect(w.z, w.x, w.y), ok: false, used: now };
        tiles2d.set(w.key, entry);
        inflight2d++;
        img.onload = () => { inflight2d--; entry.ok = true; };
        img.onerror = () => { inflight2d--; };
        img.src = `/tiles/yanis16/${w.z}/${w.x}/${w.y}.jpg`;
      }
      if (tiles2d.size > 260) [...tiles2d.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, tiles2d.size - 260).forEach(([k]) => tiles2d.delete(k));
    }
  }
  if (!currentZ) return;
  const [cx0, cy0] = gameToScreen(CROP_GAME.minX, CROP_GAME.maxY);
  const [cx1, cy1] = gameToScreen(CROP_GAME.maxX, CROP_GAME.minY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  const list = [...tiles2d.values()].filter((t) => t.ok && t.z <= currentZ).sort((a, b) => a.z - b.z);
  for (const t of list) {
    const [x0, y0] = gameToScreen(t.rect.minX, t.rect.maxY);
    const [x1, y1] = gameToScreen(t.rect.maxX, t.rect.minY);
    if (x1 < 0 || y1 < 0 || x0 > view.width || y0 > view.height) continue;
    ctx.drawImage(t.img, x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
  }
  ctx.restore();
}

/** Canvas 2D renderer used when WebGL is unavailable or the user picks "2D". Same rig, same transforms. */
export function Map2D({ draft }: { draft: import("../lib/types.ts").Shape | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    const cam = new THREE.OrthographicCamera();
    rig.mode = "atlas";
    rig.setCamera(cam);
    const img = new Image();
    // The 2D renderer draws tiles opportunistically over the overview, so the overview alone makes the first view usable.
    img.onload = () => { useReadiness.getState().mark("overview"); useReadiness.getState().mark("view"); };
    img.onerror = () => useReadiness.getState().fail("overview", "overview");
    img.src = OVERVIEW_URL;
    const unsubRetry = useReadiness.subscribe((s, prev) => {
      if (s.attempt !== prev.attempt && !(img.complete && img.naturalWidth)) { img.src = ""; img.src = OVERVIEW_URL; }
    });
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000; last = now;
      rig.update(now);
      const s = useStore.getState();
      applyFilter(s.layers, s.filter);
      updateClusters(s.layers.clusters, s.selectedId);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = view.width, H = view.height;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dark = s.mode === "afterdark";
      ctx.fillStyle = dark ? "#09081B" : "#2868A8";
      ctx.fillRect(0, 0, W, H);
      if (img.complete && img.naturalWidth) {
        const [x0, y0] = gameToScreen(CROP_GAME.minX, CROP_GAME.maxY);
        const [x1, y1] = gameToScreen(CROP_GAME.maxX, CROP_GAME.minY);
        const cr = GTADB_OVERVIEW.crop;
        ctx.imageSmoothingEnabled = view.ppu < 0.12;
        ctx.filter = dark ? "invert(1) hue-rotate(180deg) brightness(0.55) contrast(1.25) saturate(1.3)" : "none";
        ctx.drawImage(img, cr.x, cr.y, cr.width, cr.height, x0, y0, x1 - x0, y1 - y0);
        drawTiles(ctx, now);
        ctx.filter = "none";
      }
      const line = (pts: XY[], color: string, width: number, alpha = 1, dash: number[] = []) => {
        if (pts.length < 2) return;
        ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
        ctx.beginPath();
        pts.forEach((p, i) => { const [x, y] = gameToScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      };
      // Routes
      const me = s.me, v = me ? s.views[me.sessionWorldId] : undefined;
      const nodes = new Map(s.scenario?.nodes.map((n) => [n.id, n.game]) ?? []);
      if (s.layers.routes && s.scenario) for (const e of s.scenario.edges) { const a = nodes.get(e.from), b = nodes.get(e.to); if (a && b) line([a, b], "#CBBFD8", 1, 0.35, e.crossing === "land" ? [] : [4, 3]); }
      if (v?.mission && ["offer", "pickup", "delivery", "complication"].includes(v.mission.stage)) line(v.mission.routeNodes.map((n) => nodes.get(n)!).filter(Boolean), "#F976B0", 3, 0.75);
      // FOV
      const sel = s.selectedId ? atlasIndex.get(s.selectedId) : null;
      if (s.layers.fov && sel?.fov && sel.x != null && sel.y != null) {
        const [hd, ang, range] = sel.fov;
        const pts: XY[] = [[sel.x, sel.y]];
        for (let i = 0; i <= 20; i++) { const [dx, dy] = headingVector(hd - ang / 2 + (ang * i) / 20); pts.push([sel.x + dx * range, sel.y + dy * range]); }
        ctx.globalAlpha = 0.25; ctx.fillStyle = "#F7A35C"; ctx.beginPath();
        pts.forEach((p, i) => { const [x, y] = gameToScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.fill(); ctx.globalAlpha = 1;
      }
      // Markers
      markers.rows.forEach((r, i) => {
        if (!markers.visible[i] || (markers.clustered[i] && r.id !== s.selectedId)) return;
        const [x, y] = gameToScreen(r.x!, r.y!);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) return;
        const selected = r.id === s.selectedId, hov = i === markers.hoverIndex;
        const col = markerColor(r, s.mode), rad = selected ? 5.5 : hov ? 4.5 : 3;
        ctx.shadowColor = col; ctx.shadowBlur = selected ? 14 : hov ? 10 : 6;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = selected ? 1.5 : 0.8; ctx.strokeStyle = selected ? "#FFF8F2" : s.mode === "atlas" ? "rgba(9,6,14,0.8)" : "rgba(255,248,242,0.6)"; ctx.stroke();
      });
      // Drawings (the measure path is drawn by LabelLayer)
      for (const sh of [...s.shapes, ...(draftRef.current ? [draftRef.current] : [])]) line(shapePoints(sh), sh.color, sh.width, sh.opacity);
      // Agents
      stepActorDisplay(v, dt, true);
      if (v && s.layers.actors) for (const a of v.actors) {
        const p = actorDisplay.get(a.id) ?? a.pos;
        const [x, y] = gameToScreen(p[0], p[1]);
        ctx.beginPath(); ctx.arc(x, y, a.id === "wren" ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = ACTOR_COLORS[a.id] ?? "#FFF8F2"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#09060E"; ctx.stroke();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsubRetry(); };
  }, []);

  return <canvas ref={ref} className="map-2d" role="img" aria-label="Community map (2D renderer)" />;
}
