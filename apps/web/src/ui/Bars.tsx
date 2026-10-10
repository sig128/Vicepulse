import { useEffect, useState } from "react";
import { formatDistance, gameDistance } from "@vicepulse/shared";
import { view } from "../map/geo.ts";
import { MAX_PX_PER_GAME_UNIT } from "../map/rig.ts";
import { useStore } from "../lib/store.ts";
import { useT } from "../lib/i18n.ts";
import { rig } from "../map/rig.ts";
import { Icon } from "./icons.tsx";
import { Stepper } from "./Dossier.tsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Wordmark({ stacked = false }: { stacked?: boolean }) {
  return (
    <span aria-hidden="true" className={stacked ? "wm-stack" : undefined} style={stacked ? undefined : { display: "inline-flex", gap: "0.08em" }}>
      <span className="gta-text" data-text="VICE">VICE</span>
      <span className="gta-text sunset" data-text="PULSE">PULSE</span>
    </span>
  );
}

/** Collapse button placed in a rail's tab row; the chevron points toward the screen edge the rail slides to. */
export function RailCollapse({ side }: { side: "left" | "right" }) {
  const t = useT();
  const swapped = useStore((s) => s.settings.layout === "swapped");
  const setSettings = useStore((s) => s.setSettings);
  const west = (side === "left") !== swapped;
  return (
    <button className="rail-collapse" onClick={() => setSettings(side === "left" ? { leftCollapsed: true } : { rightCollapsed: true })} aria-label={t("Collapse panel")} title={t("Collapse panel")}>
      {west ? <Icon.chevronLeft /> : <Icon.chevronRight />}
    </button>
  );
}

export function RailTabs() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const setSettings = useStore((st) => st.setSettings);
  return (
    <>
      <button className="rail-tab left glass" onClick={() => setSettings({ leftCollapsed: false })} aria-label={t("Open network panel")} hidden={!s.leftCollapsed}>
        <Icon.feed /><span>{t("Network")}</span>
      </button>
      <button className="rail-tab right glass" onClick={() => setSettings({ rightCollapsed: false })} aria-label={t("Open dossier panel")} hidden={!s.rightCollapsed}>
        <Icon.mission /><span>{t("Dossier")}</span>
      </button>
    </>
  );
}

/** Zoom, fit and orientation controls; disabled states mirror the rig's real zoom limits. */
export function MapControls() {
  const t = useT();
  const mode = useStore((s) => s.mode);
  const [lim, setLim] = useState({ inMax: false, outMax: false, pct: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const next = { inMax: rig.atMaxZoom, outMax: rig.atMinZoom, pct: Math.round((view.ppu / MAX_PX_PER_GAME_UNIT) * 100) };
      setLim((p) => (p.inMax === next.inMax && p.outMax === next.outMax && p.pct === next.pct ? p : next));
    }, 200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="map-controls" role="group" aria-label={t("Map controls")}>
      <div className="stack-btns glass">
        <button onClick={() => rig.zoomBy(0.66)} disabled={lim.inMax} aria-label={t("Zoom in")} title={lim.inMax ? "Native source resolution reached" : "Zoom in"}><Icon.plus /></button>
        <div className="zoom-readout" title="Share of native source resolution (100% = one source pixel per screen pixel)">{lim.pct}%</div>
        <button onClick={() => rig.zoomBy(1.5)} disabled={lim.outMax} aria-label={t("Zoom out")} title="Zoom out"><Icon.minus /></button>
      </div>
      <div className="stack-btns glass">
        <button onClick={() => rig.fitCrop()} aria-label={t("Fit map")} title="Fit map"><Icon.fit /></button>
        {mode === "afterdark" && <button onClick={() => rig.resetOrientation()} aria-label={t("Reset tilt and rotation")} title="Reset tilt and rotation"><Icon.compass /></button>}
      </div>
    </div>
  );
}

export function TopBar() {
  const t = useT();
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const setOverlay = useStore((s) => s.setOverlay);
  const overlay = useStore((s) => s.overlay);
  const conn = useStore((s) => s.conn);
  const me = useStore((s) => s.me);
  const view = useStore((s) => (me ? s.views[me.sessionWorldId] : undefined));
  const checkpoint = view?.checkpoint.active;
  return (
    <header className="topbar">
      <a className="wordmark" href="/" onClick={(e) => { e.preventDefault(); setOverlay(null); rig.fitCrop(); }} aria-label="VICEPULSE home">
        <Wordmark /><small>Community atlas · unofficial</small>
      </a>
      <div className="seg" role="group" aria-label="Map mode">
        <button aria-pressed={mode === "atlas"} onClick={() => setMode("atlas")} title="Top-down, source colours">{t("Atlas")}</button>
        <button aria-pressed={mode === "afterdark"} onClick={() => setMode("afterdark")} title="Tilted 3D night view of the same geometry">{t("Afterdark")}</button>
      </div>
      <button className="search-btn" onClick={() => setOverlay("palette")} aria-label="Open command palette">
        <Icon.search /><span>{t("Search markers, places, commands…")}</span><kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <div className="spacer" />
      <nav className="row desk" style={{ gap: 2 }} aria-label="Panels">
        {([["browser", "Markers"], ["media", "Media"], ["finder", "Marker Finder"], ["sources", "Sources"], ["rewards", "Rewards"], ["settings", "Settings"]] as const).map(([k, l]) => (
          <button key={k} className="icon-btn" aria-pressed={overlay === k} onClick={() => setOverlay(overlay === k ? null : k)}>{t(l)}</button>
        ))}
        <button className="icon-btn" onClick={() => setOverlay("about")}>{t("About")}</button>
      </nav>
      {view && <span className="clock desk" title={`City time · ${view.simRate}× real time`}>{view.clock}</span>}
      {checkpoint && <span className="chip desk cp-chip" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>VCPD · causeway</span>}
      {view?.resources && <span className="chip desk">$<strong>{view.resources.cash}</strong></span>}
      <span className={`chip ${conn}`} title={conn === "live" ? "Realtime connected" : conn === "offline" ? "Reconnecting — you'll get missed events on resume" : "Connecting"}>{t(conn === "live" ? "Live" : conn === "offline" ? "Offline" : "Connecting")}</span>
    </header>
  );
}

export function BottomStrip() {
  const t = useT();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const layers = useStore((s) => s.layers);
  const setLayers = useStore((s) => s.setLayers);
  const hover = useStore((s) => s.hoverGame);
  const measure = useStore((s) => s.measure);
  const setMeasure = useStore((s) => s.setMeasure);
  const units = useStore((s) => s.settings.units);
  const draw = useStore((s) => s.draw);
  const setDraw = useStore((s) => s.setDraw);
  const undo = useStore((s) => s.undo), redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0), canRedo = useStore((s) => s.redoStack.length > 0);
  const shapes = useStore((s) => s.shapes);
  const commit = useStore((s) => s.commitShapes);
  const me = useStore((s) => s.me);
  const stage = useStore((s) => (me ? s.views[me.sessionWorldId]?.mission?.stage : undefined));
  const total = measure.reduce((n, p, i) => (i ? n + gameDistance(measure[i - 1], p) : 0), 0);
  const L = (k: keyof typeof layers, label: string, I: () => React.JSX.Element) => (
    <button className="tool" title={t(label)} aria-pressed={!!layers[k]} onClick={() => setLayers({ [k]: !layers[k] } as any)}><I />{t(label)}</button>
  );
  return (
    <footer className="bottom glass">
      <div className="group" role="group" aria-label={t("Tools")}>
        <button className="tool" title={t("Measure")} aria-pressed={tool === "measure"} onClick={() => setTool(tool === "measure" ? "none" : "measure")}><Icon.measure />{t("Measure")}</button>
        <button className="tool" title={t("Draw")} aria-pressed={tool === "draw"} onClick={() => setTool(tool === "draw" ? "none" : "draw")}><Icon.draw />{t("Draw")}</button>
        <button className="tool" title="Fit" onClick={() => rig.fitCrop()}><Icon.fit />Fit</button>
      </div>
      {tool === "measure" && (
        <div className="group">
          <span className="mono" style={{ color: "var(--text)" }}>{measure.length < 2 ? "Click points on the map" : formatDistance(total, units)}</span>
          <button className="btn" style={{ padding: "4px 10px" }} onClick={() => setMeasure(measure.slice(0, -1))} disabled={!measure.length}>{t("Undo")}</button>
          <button className="btn" style={{ padding: "4px 10px" }} onClick={() => setMeasure([])} disabled={!measure.length}>{t("Clear")}</button>
        </div>
      )}
      {tool === "draw" && (
        <div className="group" style={{ gap: 6 }}>
          <div className="seg">
            {(["pen", "line", "rect", "circle"] as const).map((k) => <button key={k} aria-pressed={draw.kind === k} onClick={() => setDraw({ kind: k })}>{k}</button>)}
          </div>
          <input type="color" value={draw.color} onChange={(e) => setDraw({ color: e.target.value })} aria-label="Colour" style={{ width: 28, height: 28, border: 0, background: "none", padding: 0 }} />
          <label className="dim" style={{ fontSize: 11 }}>W<input type="range" min={1} max={16} value={draw.width} onChange={(e) => setDraw({ width: +e.target.value })} style={{ width: 60 }} aria-label="Thickness" /></label>
          <label className="dim" style={{ fontSize: 11 }}>α<input type="range" min={0.1} max={1} step={0.05} value={draw.opacity} onChange={(e) => setDraw({ opacity: +e.target.value })} style={{ width: 50 }} aria-label="Opacity" /></label>
          <button className="tool" style={{ minWidth: 40 }} onClick={undo} disabled={!canUndo} aria-label={t("Undo")}><Icon.undo /></button>
          <button className="tool" style={{ minWidth: 40 }} onClick={redo} disabled={!canRedo} aria-label={t("Redo")}><Icon.redo /></button>
          <button className="tool" style={{ minWidth: 40 }} onClick={() => commit([])} disabled={!shapes.length} aria-label={t("Clear")}><Icon.trash /></button>
        </div>
      )}
      <div className="sep" />
      <div className="group" role="group" aria-label={t("Layers")}>
        {L("clusters", "Clusters", Icon.cluster)}
        {L("heat", "Marker density", Icon.heat)}
        {L("grid", "Grid", Icon.grid)}
        {L("routes", "Routes", Icon.route)}
        {L("fov", "Field of view", Icon.fov)}
        {L("actors", "Agents", Icon.agent)}
      </div>
      <div className="sep" />
      <div className="coords" aria-live="off">
        {hover ? <>X <b>{hover[0].toFixed(0)}</b> · Y <b>{hover[1].toFixed(0)}</b></> : <span className="dim">{t("Game coordinates")}</span>}
      </div>
      <div style={{ flex: 1 }} />
      {stage && <Stepper stage={stage} />}
    </footer>
  );
}
