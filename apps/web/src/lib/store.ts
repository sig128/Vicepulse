import { create } from "zustand";
import type { Me, Scenario, Shape, WorldEvent, WorldView, XY, ActorView } from "./types.ts";

export type MapMode = "atlas" | "afterdark";
export type Overlay = null | "browser" | "media" | "finder" | "settings" | "sources" | "rewards" | "palette" | "about" | "realworld" | "evidence";
export type Tool = "none" | "measure" | "draw";
export type DrawKind = Shape["kind"];
export type MobileSheet = null | "feed" | "mission" | "atlas" | "more";

export interface Settings {
  theme: "night" | "dusk" | "contrast";
  glass: boolean;
  accent: "pink" | "sunset" | "blue";
  background: "deep" | "ink" | "grid";
  layout: "default" | "swapped" | "map-focus";
  units: "metric" | "imperial";
  lang: "en" | "de";
  motion: "system" | "reduce" | "full";
  renderer: "auto" | "2d";
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

const SETTINGS_KEY = "vicepulse.settings.v1";
const defaults: Settings = { theme: "night", glass: true, accent: "pink", background: "deep", layout: "default", units: "metric", lang: "en", motion: "system", renderer: "auto", leftCollapsed: false, rightCollapsed: false };

function loadSettings(): Settings {
  try {
    const s = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    if (!["pink", "sunset", "blue"].includes(s.accent)) s.accent = defaults.accent;
    return s;
  } catch { return defaults; }
}

export interface Layers {
  datasets: boolean[];
  clusters: boolean;
  heat: boolean;
  grid: boolean;
  routes: boolean;
  fov: boolean;
  actors: boolean;
  sol: boolean;
}

interface CameraRequest { x: number; y: number; span?: number; t: number }

interface State {
  settings: Settings;
  setSettings(p: Partial<Settings>): void;

  mode: MapMode;
  setMode(m: MapMode): void;
  overlay: Overlay;
  setOverlay(o: Overlay): void;
  mobileSheet: MobileSheet;
  setMobileSheet(s: MobileSheet): void;
  dossierTab: "record" | "mission";
  setDossierTab(t: "record" | "mission"): void;
  leftTab: "feed" | "contacts" | "crew";
  setLeftTab(t: "feed" | "contacts" | "crew"): void;

  selectedId: string | null;
  select(id: string | null, opts?: { fly?: boolean }): void;
  hoverGame: XY | null;
  setHoverGame(p: XY | null): void;
  camera: CameraRequest | null;
  flyTo(x: number, y: number, span?: number): void;

  layers: Layers;
  setLayers(p: Partial<Layers>): void;
  toggleDataset(i: number): void;
  filter: { q: string; category: string | null };
  setFilter(p: Partial<{ q: string; category: string | null }>): void;

  tool: Tool;
  setTool(t: Tool): void;
  measure: XY[];
  setMeasure(p: XY[]): void;

  draw: { kind: DrawKind; color: string; width: number; opacity: number };
  setDraw(p: Partial<State["draw"]>): void;
  shapes: Shape[];
  undoStack: Shape[][];
  redoStack: Shape[][];
  commitShapes(next: Shape[]): void;
  loadShapes(s: Shape[]): void;
  undo(): void;
  redo(): void;

  finderPick: ((p: XY) => void) | null;
  setFinderPick(fn: ((p: XY) => void) | null): void;

  me: Me | null;
  setMe(m: Me): void;
  scenario: Scenario | null;
  setScenario(s: Scenario): void;
  views: Record<string, WorldView>;
  events: Record<string, WorldEvent[]>;
  lastSeq: Record<string, number>;
  conn: "connecting" | "live" | "offline";
  setConn(c: State["conn"]): void;
  setView(worldId: string, v: WorldView): void;
  patchActors(worldId: string, p: { simTime: number; clock: string; seq: number; actors: Partial<ActorView>[]; checkpoint: WorldView["checkpoint"]; complication: unknown }): void;
  addEvents(worldId: string, evs: WorldEvent[], throughSeq?: number): void;
  resetWorld(worldId: string): void;
  toast: { id: number; text: string; tone: "info" | "warn" | "good" } | null;
  notify(text: string, tone?: "info" | "warn" | "good"): void;
}

const MAX_EVENTS = 400;

export const useStore = create<State>((set, get) => ({
  settings: loadSettings(),
  setSettings(p) {
    const s = { ...get().settings, ...p };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    set({ settings: s });
  },

  mode: (localStorage.getItem("vicepulse.mode") as MapMode) || "afterdark",
  setMode(m) { localStorage.setItem("vicepulse.mode", m); set({ mode: m }); },
  overlay: null,
  setOverlay(o) { set({ overlay: o }); },
  mobileSheet: null,
  setMobileSheet(s) { set({ mobileSheet: s }); },
  dossierTab: "mission",
  setDossierTab(t) { set({ dossierTab: t }); },
  leftTab: "feed",
  setLeftTab(t) { set({ leftTab: t }); },

  selectedId: null,
  select(id, opts) {
    set({ selectedId: id, dossierTab: id ? "record" : get().dossierTab });
    const url = new URL(location.href);
    if (id) url.searchParams.set("marker", id); else url.searchParams.delete("marker");
    history.replaceState(null, "", url);
    if (id && opts?.fly) {
      const rec = atlasIndex.get(id);
      if (rec && rec.x != null && rec.y != null) get().flyTo(rec.x, rec.y, 1600);
    }
  },
  hoverGame: null,
  setHoverGame(p) { set({ hoverGame: p }); },
  camera: null,
  flyTo(x, y, span) { set({ camera: { x, y, span, t: performance.now() } }); },

  layers: { datasets: [true, true, true, true, true, true], clusters: true, heat: false, grid: false, routes: true, fov: true, actors: true, sol: false },
  setLayers(p) { set({ layers: { ...get().layers, ...p } }); },
  toggleDataset(i) { const d = [...get().layers.datasets]; d[i] = !d[i]; set({ layers: { ...get().layers, datasets: d } }); },
  filter: { q: "", category: null },
  setFilter(p) { set({ filter: { ...get().filter, ...p } }); },

  tool: "none",
  setTool(t) { set({ tool: t, measure: t === "measure" ? get().measure : [] }); },
  measure: [],
  setMeasure(p) { set({ measure: p }); },

  draw: { kind: "pen", color: "#F976B0", width: 4, opacity: 0.9 },
  setDraw(p) { set({ draw: { ...get().draw, ...p } }); },
  shapes: [],
  undoStack: [],
  redoStack: [],
  commitShapes(next) { set({ undoStack: [...get().undoStack.slice(-49), get().shapes], redoStack: [], shapes: next }); },
  loadShapes(s) { set({ shapes: s, undoStack: [], redoStack: [] }); },
  undo() {
    const u = get().undoStack;
    if (!u.length) return;
    set({ shapes: u[u.length - 1], undoStack: u.slice(0, -1), redoStack: [...get().redoStack, get().shapes] });
  },
  redo() {
    const r = get().redoStack;
    if (!r.length) return;
    set({ shapes: r[r.length - 1], redoStack: r.slice(0, -1), undoStack: [...get().undoStack, get().shapes] });
  },

  finderPick: null,
  setFinderPick(fn) { set({ finderPick: fn }); },

  me: null,
  setMe(m) { set({ me: m }); },
  scenario: null,
  setScenario(s) { set({ scenario: s }); },
  views: {},
  events: {},
  lastSeq: {},
  conn: "connecting",
  setConn(c) { set({ conn: c }); },
  setView(worldId, v) {
    set({ views: { ...get().views, [worldId]: v }, lastSeq: { ...get().lastSeq, [worldId]: Math.max(get().lastSeq[worldId] ?? 0, v.seq) } });
  },
  patchActors(worldId, p) {
    const v = get().views[worldId];
    if (!v || p.seq < v.seq) return;
    const byId = new Map(p.actors.map((a) => [a.id, a]));
    set({
      views: {
        ...get().views,
        [worldId]: {
          ...v, simTime: p.simTime, clock: p.clock, checkpoint: p.checkpoint,
          actors: v.actors.map((a) => ({ ...a, ...(byId.get(a.id) ?? {}) })),
          mission: v.mission && p.complication !== undefined ? { ...v.mission, complication: p.complication as any } : v.mission,
        },
      },
    });
  },
  addEvents(worldId, evs, throughSeq) {
    const cur = get().events[worldId] ?? [];
    const seen = new Set(cur.map((e) => e.id));
    const merged = [...cur, ...evs.filter((e) => !seen.has(e.id))].sort((a, b) => a.sequence - b.sequence).slice(-MAX_EVENTS);
    const maxSeq = Math.max(get().lastSeq[worldId] ?? 0, throughSeq ?? 0, ...evs.map((e) => e.sequence));
    set({ events: { ...get().events, [worldId]: merged }, lastSeq: { ...get().lastSeq, [worldId]: maxSeq } });
  },
  resetWorld(worldId) {
    const { [worldId]: _e, ...events } = get().events;
    const { [worldId]: _s, ...lastSeq } = get().lastSeq;
    set({ events, lastSeq });
  },
  toast: null,
  notify(text, tone = "info") {
    const id = Date.now();
    set({ toast: { id, text, tone } });
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, 4200);
  },
}));

// Populated by atlas.ts once the compact bundle loads; kept outside React state for speed.
export interface AtlasRow { id: string; ds: number; label: string; category: string; tags: string[]; x: number | null; y: number | null; rw: boolean; photo: boolean; fov: [number, number, number] | null; color: string | null }
export const atlasIndex = new Map<string, AtlasRow>();
