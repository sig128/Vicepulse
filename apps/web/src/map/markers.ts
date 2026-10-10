import { DATASET_COLORS } from "@vicepulse/shared";
import type { AtlasRow, Layers } from "../lib/store.ts";
import { CATEGORY_COLORS } from "../lib/atlas.ts";
import { gameToScreen, view } from "./geo.ts";

export interface Cluster { x: number; y: number; count: number; members: number[] }

/** Shared, non-React marker state (rebuilt on filter/zoom-level change, read every frame). */
export const markers = {
  rows: [] as AtlasRow[],          // rows with game coordinates, index = point index
  datasets: [] as string[],
  visible: new Uint8Array(0),      // passes dataset/category/search filter
  clustered: new Uint8Array(0),    // hidden because it is inside a cluster
  clusters: [] as Cluster[],
  cell: 0,
  hoverIndex: -1,
  hoverCluster: null as Cluster | null,
  version: 0,
  filterKey: "",
};

export function setRows(rows: AtlasRow[], datasets: string[]) {
  markers.rows = rows.filter((r) => r.x != null && r.y != null);
  markers.datasets = datasets;
  markers.visible = new Uint8Array(markers.rows.length).fill(1);
  markers.clustered = new Uint8Array(markers.rows.length);
  markers.filterKey = "";
  markers.cell = Number.NaN;
}

export function matches(r: AtlasRow, q: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  return r.id.toLowerCase() === s || r.id.toLowerCase().startsWith(s) || r.label.toLowerCase().includes(s) || r.tags.some((t) => t.toLowerCase() === s);
}

export function applyFilter(layers: Layers, filter: { q: string; category: string | null }) {
  const key = `${layers.datasets.join("")}|${filter.q}|${filter.category}`;
  if (key === markers.filterKey) return false;
  markers.filterKey = key;
  markers.rows.forEach((r, i) => {
    markers.visible[i] = layers.datasets[r.ds] !== false && (!filter.category || r.category === filter.category) && matches(r, filter.q) ? 1 : 0;
  });
  forceRecluster();
  markers.version++;
  return true;
}

/** Screen radius (CSS px) within which markers merge into one cluster. */
const CLUSTER_RADIUS_PX = 56;
/** Above this zoom (px per game unit) every marker is shown individually. */
const MAX_CLUSTER_PPU = 1.2;
const NO_CLUSTERS = 1e9;

/**
 * Distance-based clustering, recomputed at every half zoom step (×√2) so clusters split gradually.
 * Computed in game space for a fixed level, so membership is stable while panning.
 */
export function updateClusters(enabled: boolean, selectedId: string | null) {
  const level = enabled && view.ppu < MAX_CLUSTER_PPU ? Math.floor(Math.log2(Math.max(view.ppu, 1e-6)) * 2) : NO_CLUSTERS;
  if (level === markers.cell) return false;
  markers.cell = level;
  markers.clustered.fill(0);
  markers.clusters = [];
  if (level !== NO_CLUSTERS) {
    const radius = CLUSTER_RADIUS_PX / 2 ** (level / 2); // game units at this level
    const rows = markers.rows;
    const grid = new Map<string, number[]>();
    const key = (cx: number, cy: number) => `${cx},${cy}`;
    rows.forEach((r, i) => {
      if (!markers.visible[i] || r.id === selectedId) return;
      const k = key(Math.floor(r.x! / radius), Math.floor(r.y! / radius));
      let a = grid.get(k);
      if (!a) grid.set(k, (a = []));
      a.push(i);
    });
    const taken = new Uint8Array(rows.length);
    // Seed from the densest cells first so big clusters form around real concentrations.
    const seeds = [...grid.values()].sort((a, b) => b.length - a.length).flat();
    for (const i of seeds) {
      if (taken[i]) continue;
      const r = rows[i], cx = Math.floor(r.x! / radius), cy = Math.floor(r.y! / radius);
      const members = [i];
      taken[i] = 1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (taken[j]) continue;
          if (Math.hypot(rows[j].x! - r.x!, rows[j].y! - r.y!) <= radius) { members.push(j); taken[j] = 1; }
        }
      }
      if (members.length < 2) continue;
      let sx = 0, sy = 0;
      for (const m of members) { sx += rows[m].x!; sy += rows[m].y!; markers.clustered[m] = 1; }
      markers.clusters.push({ x: sx / members.length, y: sy / members.length, count: members.length, members });
    }
  }
  markers.version++;
  return true;
}

export function forceRecluster() { markers.cell = Number.NaN; }

export function markerColor(r: AtlasRow, mode: "atlas" | "afterdark") {
  const ds = markers.datasets[r.ds];
  if (r.color) return vivid(r.color);
  if (mode === "atlas") return vivid(DATASET_COLORS[ds] ?? "#7884F7");
  return ds === "gtadb_landmarks" ? (CATEGORY_COLORS[r.category] ?? CATEGORY_COLORS.default) : (DATASET_COLORS[ds] ?? "#7884F7");
}

const vividCache = new Map<string, string>();
/** Keeps a source colour's hue but lifts lightness/saturation so a small glowing dot stays legible on any basemap. */
export function vivid(hex: string) {
  let out = vividCache.get(hex);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  if (h < 0) h += 6;
  const l0 = (max + min) / 2, s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
  const l = Math.min(0.68, Math.max(0.56, l0)), s = d ? Math.max(0.62, s0) : 0;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  const [rr, gg, bb] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  out = "#" + [rr, gg, bb].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, "0")).join("");
  vividCache.set(hex, out);
  return out;
}

/** Cluster colour tiers by member count (small → large): periwinkle, mint, orange, coral-red. */
export const CLUSTER_TIERS: [number, string][] = [[10, "#7884F7"], [50, "#3FD69A"], [100, "#F7A35C"], [Infinity, "#F4606F"]];
export const clusterColor = (count: number) => CLUSTER_TIERS.find(([max]) => count < max)![1];
export const clusterRadius = (count: number) => 9 + Math.min(9, Math.log2(count) * 1.6);

export type Pick = { kind: "marker"; index: number } | { kind: "cluster"; cluster: Cluster } | null;

export function pickAt(px: number, py: number, radius = 14): Pick {
  let best: Pick = null, bd = radius;
  markers.rows.forEach((r, i) => {
    if (!markers.visible[i] || markers.clustered[i]) return;
    const [sx, sy, ok] = gameToScreen(r.x!, r.y!);
    if (!ok) return;
    const d = Math.hypot(sx - px, sy - py);
    if (d < bd) { bd = d; best = { kind: "marker", index: i }; }
  });
  if (best) return best;
  for (const c of markers.clusters) {
    const [sx, sy, ok] = gameToScreen(c.x, c.y);
    if (ok && Math.hypot(sx - px, sy - py) < clusterRadius(c.count) + 4) return { kind: "cluster", cluster: c };
  }
  return null;
}
