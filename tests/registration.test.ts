import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { gameToOverview } from "@vicepulse/shared";
import { loadOverview, isLandNear, waterFractionAlong, type Raster } from "../scripts/lib/landmask.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const records: { id: string; game: [number, number] | null; label: string }[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data/normalized/gtadb-landmarks.json"), "utf8"));
const byId = new Map(records.map((r) => [r.id, r]));
const scenario = JSON.parse(fs.readFileSync(path.join(ROOT, "data/scenarios/night-shift.json"), "utf8"));

let img: Raster;
beforeAll(async () => { img = await loadOverview(); });

/** Sampled on the actual YANIS raster — a numeric round trip alone cannot prove alignment. */
describe("map registration against the raster", () => {
  const land = ["L588", "L689", "L13", "L281", "L399", "L530", "L273", "L1560"];
  it.each(land)("%s sits on land at the registered pixel", (id) => {
    const r = byId.get(id)!;
    const [px, py] = gameToOverview(r.game![0], r.game![1]);
    expect(isLandNear(img, px, py, 1), `${id} ${r.label} @ ${px.toFixed(1)},${py.toFixed(1)}`).toBe(true);
  });

  it("negative control L1556 (Gulf of Leonida label) is open water", () => {
    const r = byId.get("L1556")!;
    const [px, py] = gameToOverview(r.game![0], r.game![1]);
    expect(isLandNear(img, px, py, 2)).toBe(false);
  });

  it("the registered transform beats a vertical flip and an axis swap by a wide margin", () => {
    const pts = records.filter((r) => r.game).map((r) => r.game!);
    const frac = (f: (x: number, y: number) => [number, number]) => pts.filter(([x, y]) => { const [px, py] = f(x, y); return px >= 0 && py >= 0 && px < img.width && py < img.height && isLandNear(img, px, py, 0); }).length / pts.length;
    const ok = frac(gameToOverview), flipped = frac((x, y) => gameToOverview(x, -y)), swapped = frac((x, y) => gameToOverview(y, x));
    expect(ok).toBeGreaterThan(0.85);
    expect(ok - flipped).toBeGreaterThan(0.2);
    expect(ok - swapped).toBeGreaterThan(0.2);
  });
});

describe("Night Shift route graph", () => {
  const nodes = new Map<string, { id: string; game: [number, number]; sourceRecordId: string | null }>(scenario.routeGraph.nodes.map((n: any) => [n.id, n]));
  const edges: { from: string; to: string; crossing: "land" | "bridge" | "tunnel" }[] = scenario.routeGraph.edges;

  it("every non-tunnel node is on land and every edge references real nodes", () => {
    const underground = [...nodes.keys()].filter((id) => edges.filter((e) => e.from === id || e.to === id).every((e) => e.crossing === "tunnel"));
    expect(underground).toEqual(["tunnel_mid"]);
    for (const n of nodes.values()) {
      if (underground.includes(n.id)) continue;
      const [px, py] = gameToOverview(n.game[0], n.game[1]);
      expect(isLandNear(img, px, py, 2), `node ${n.id}`).toBe(true);
    }
    for (const e of edges) { expect(nodes.has(e.from), e.from).toBe(true); expect(nodes.has(e.to), e.to).toBe(true); }
  });

  it("land edges never cross open water; water crossings are declared bridges or tunnels", () => {
    const report = edges.map((e) => ({ e, water: waterFractionAlong(img, nodes.get(e.from)!.game, nodes.get(e.to)!.game) }));
    for (const { e, water } of report) {
      if (e.crossing === "land") expect(water, `${e.from}→${e.to} is marked land but ${(water * 100).toFixed(0)}% water`).toBeLessThanOrEqual(0.12);
    }
    // At least one declared crossing actually spans water — otherwise the "bridge" label is meaningless.
    expect(report.some(({ e, water }) => e.crossing !== "land" && water > 0.25)).toBe(true);
  });

  it("nodes tied to atlas records sit near their record (≤ 400 units)", () => {
    for (const n of nodes.values()) {
      if (!n.sourceRecordId) continue;
      const r = byId.get(n.sourceRecordId);
      expect(r, n.sourceRecordId).toBeTruthy();
      if (!r?.game) continue;
      expect(Math.hypot(r.game[0] - n.game[0], r.game[1] - n.game[1]), `${n.id}↔${n.sourceRecordId}`).toBeLessThanOrEqual(400);
    }
  });
});
