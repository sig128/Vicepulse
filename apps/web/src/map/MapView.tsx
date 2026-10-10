import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useStore } from "../lib/store.ts";
import type { Shape, XY } from "../lib/types.ts";
import { useAtlas } from "../lib/atlas.ts";
import { prefersReducedMotion, gameToScreen, screenToGame, view, webglAvailable } from "./geo.ts";
import { rig } from "./rig.ts";
import { markers, pickAt, setRows } from "./markers.ts";
import { Overview, OVERVIEW_URL, Tiles, RasterModeDriver, SolCompare, tileActivity } from "./Basemap.tsx";
import { useReadiness } from "../lib/readiness.ts";
import { MarkerPoints } from "./MarkerPoints.tsx";
import { Heatmap } from "./Heatmap.tsx";
import { Actors, FovCone, Grid, MissionRings, Routes, Shapes, actorDisplay } from "./Overlays3D.tsx";
import { LabelLayer } from "./LabelLayer.tsx";
import { Map2D } from "./Map2D.tsx";
import { ACCENT_INDEX } from "./rasterMaterial.ts";
import { useT } from "../lib/i18n.ts";

function CameraRig({ mode }: { mode: "atlas" | "afterdark" }) {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);
  const cams = useMemo(() => ({ ortho: new THREE.OrthographicCamera(), persp: new THREE.PerspectiveCamera(38, 1, 0.1, 5000) }), []);
  useEffect(() => {
    rig.mode = mode;
    const cam = mode === "atlas" ? cams.ortho : cams.persp;
    (cam as any).manual = true;
    set({ camera: cam as any });
    rig.setCamera(cam);
  }, [mode, cams, set]);
  useEffect(() => { rig.resize(size.width, size.height); }, [size.width, size.height]);
  useFrame(() => { rig.update(performance.now()); });
  return null;
}

function SceneBackground({ mode, background }: { mode: string; background: string }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  if (import.meta.env.DEV) (window as any).__vpDebug = { scene, gl };
  useEffect(() => {
    scene.background = new THREE.Color(mode === "atlas" ? "#2868A8" : background === "ink" ? "#070614" : "#09081B");
  }, [mode, background, scene]);
  return null;
}

/** A failed overview load becomes a retryable readiness error instead of unmounting the whole app. */
class OverviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) {
    useLoader.clear(THREE.TextureLoader, OVERVIEW_URL);
    useReadiness.getState().fail("overview", String((e as Error)?.message ?? e));
  }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Small spinner in the map badge while tiles stream after the entrance (zooming, panning, mode switches). */
function TileActivity() {
  const [busy, setBusy] = useState(false);
  const booting = useReadiness((s) => s.phase !== "ready" && !s.dismissed);
  useEffect(() => {
    let since = 0;
    const id = setInterval(() => {
      // Only show after ~250 ms of continuous loading so quick refills don't flicker.
      if (tileActivity.inflight > 0) { since ||= performance.now(); setBusy(performance.now() - since > 250); }
      else { since = 0; setBusy(false); }
    }, 125);
    return () => clearInterval(id);
  }, []);
  if (booting || !busy) return null;
  return <i className="spinner-sm" role="status" aria-label="Loading map detail" />;
}

function reducedMotion(setting: string) {
  return setting === "reduce" || (setting === "system" && prefersReducedMotion());
}

export function MapView() {
  const t = useT();
  const { data, error } = useAtlas();
  const mode = useStore((s) => s.mode);
  const settings = useStore((s) => s.settings);
  const layers = useStore((s) => s.layers);
  const shapes = useStore((s) => s.shapes);
  const selectedId = useStore((s) => s.selectedId);
  const me = useStore((s) => s.me);
  const tool = useStore((s) => s.tool);
  const [glFailed, setGlFailed] = useState(() => !webglAvailable());
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Shape | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const reduced = reducedMotion(settings.motion);
  const use2D = glFailed || settings.renderer === "2d";

  useEffect(() => { if (data) { setRows(data.rows, data.datasets); setReady(true); } }, [data]);
  useEffect(() => { rig.reducedMotion = reduced; }, [reduced]);

  useEffect(() => {
    const node = el.current!;
    rig.attach(node);
    const ro = new ResizeObserver(([e]) => {
      const first = view.width <= 1;
      rig.resize(e.contentRect.width, e.contentRect.height);
      if (first && !new URL(location.href).searchParams.get("marker")) rig.fitCrop();
    });
    ro.observe(node);
    return () => { ro.disconnect(); rig.detach(); };
  }, []);

  useEffect(() => useStore.subscribe((s, prev) => {
    if (s.camera && s.camera !== prev.camera) rig.flyTo(s.camera.x, s.camera.y, s.camera.span);
  }), []);

  // Pointer handlers read the latest state on every event.
  useEffect(() => {
    let hoverRaf = 0;
    rig.handlers = {
      click(px, py) {
        const s = useStore.getState();
        const g = screenToGame(px, py);
        if (s.finderPick && g) { s.finderPick(g); return; }
        if (s.tool === "measure" && g) { s.setMeasure([...s.measure, g]); return; }
        const p = pickAt(px, py);
        if (p?.kind === "marker") { s.select(markers.rows[p.index].id); s.setMobileSheet(null); return; }
        if (p?.kind === "cluster") {
          const xs = p.cluster.members.map((m) => markers.rows[m].x!), ys = p.cluster.members.map((m) => markers.rows[m].y!);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
          const fit = Math.max(w, h * (view.width / view.height)) * 1.8;
          rig.flyTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.min((view.span * 100) / 2, Math.max(fit, 200)));
          return;
        }
        const v = s.me ? s.views[s.me.sessionWorldId] : undefined;
        const actor = v?.actors.find((a) => {
          const pos = actorDisplay.get(a.id) ?? a.pos;
          const [sx, sy, ok] = gameToScreen(pos[0], pos[1]);
          return ok && Math.hypot(sx - px, sy - py) < 14;
        });
        if (actor) { s.setLeftTab(actor.id === "wren" ? "crew" : "contacts"); s.notify(`${actor.name}: ${actor.task}`); }
      },
      hover(g, px, py) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = requestAnimationFrame(() => {
          useStore.getState().setHoverGame(g);
          const p = g ? pickAt(px, py, 10) : null;
          markers.hoverIndex = p?.kind === "marker" ? p.index : -1;
          markers.hoverCluster = p?.kind === "cluster" ? p.cluster : null;
          if (el.current) el.current.style.cursor = useStore.getState().finderPick || useStore.getState().tool !== "none" ? "crosshair" : p ? "pointer" : "grab";
        });
      },
      drawStart(g) {
        const s = useStore.getState();
        if (s.tool !== "draw") return false;
        const d = s.draw;
        const shape: Shape = d.kind === "pen" || d.kind === "line"
          ? { kind: d.kind, points: [g, g], color: d.color, width: d.width, opacity: d.opacity }
          : { kind: d.kind, points: [g, g], color: d.color, width: d.width, opacity: d.opacity };
        draftRef.current = shape; setDraft(shape);
        return true;
      },
      drawMove(g) {
        const cur = draftRef.current;
        if (!cur) return;
        let next: Shape;
        if (cur.kind === "pen") {
          const lastP = cur.points[cur.points.length - 1];
          const minStep = 3 / Math.max(view.ppu, 1e-6);
          if (Math.hypot(g[0] - lastP[0], g[1] - lastP[1]) < minStep || cur.points.length >= 2000) return;
          next = { ...cur, points: [...cur.points, g] };
        } else next = { ...cur, points: [cur.points[0], g] } as Shape;
        draftRef.current = next; setDraft(next);
      },
      drawEnd() {
        const cur = draftRef.current;
        draftRef.current = null; setDraft(null);
        if (!cur) return;
        const [a, b] = [cur.points[0], cur.points[cur.points.length - 1]];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 2 / Math.max(view.ppu, 1e-6) && cur.kind !== "pen") return;
        const s = useStore.getState();
        s.commitShapes([...s.shapes, { ...cur, points: cur.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as XY) } as Shape]);
      },
    };
    return () => { rig.handlers = null; };
  }, []);

  const sessionWorld = me?.sessionWorldId;
  const attempt = useReadiness((s) => s.attempt);

  return (
    <div ref={el} className={`map-root mode-${mode}`} tabIndex={0} aria-label={`${t("Community map")} — ${mode === "atlas" ? "Atlas" : "Afterdark"}. Arrow keys pan, plus and minus zoom.`} data-tool={tool}>
      {use2D ? (
        <Map2D draft={draft} />
      ) : (
        <Canvas
          className="map-gl"
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setGlFailed(true); });
          }}
          frameloop="always"
        >
          <CameraRig mode={mode} />
          <SceneBackground mode={mode} background={settings.background} />
          <RasterModeDriver mode={mode} accent={ACCENT_INDEX[settings.accent]} reduced={reduced} />
          <OverviewBoundary key={attempt}>
            <Suspense fallback={null}>
              <Overview />
            </Suspense>
          </OverviewBoundary>
          <Tiles />
          {layers.sol && <SolCompare opacity={0.6} />}
          {layers.grid && <Grid />}
          {ready && layers.heat && <Heatmap />}
          {layers.fov && <FovCone id={selectedId} />}
          <Routes worldId={sessionWorld} showGraph={layers.routes} />
          <MissionRings worldId={sessionWorld} reduced={reduced} />
          {ready && <MarkerPoints key={markers.rows.length} reduced={reduced} />}
          <Shapes shapes={shapes} draft={draft} />
          {layers.actors && <Actors worldId={sessionWorld} reduced={reduced} />}
        </Canvas>
      )}
      <LabelLayer />
      {settings.background === "grid" && <div className="map-bg-grid" aria-hidden="true" />}
      <div className="map-badge" title="Fan-made reconstruction from community sources. Not official geography.">
        <span>{t("Community map")}</span><TileActivity />
        <small>{mode === "atlas" ? "Atlas · source colours" : "Afterdark · same geometry"}{use2D ? " · 2D" : ""}</small>
      </div>
      {error && <div className="map-error" role="alert">{error}</div>}
    </div>
  );
}