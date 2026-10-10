import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const landmarks: any[] = read("data/normalized/gtadb-landmarks.json");
const coverage = read("data/source-manifests/coverage-report.json");
const atlasFile = path.join(ROOT, "apps/web/public/generated/atlas.json");
const hasAtlas = fs.existsSync(atlasFile);

describe("import reconciliation (recomputed from data, not read back from the report)", () => {
  it("GTADB landmarks: 3100 unique records, 60 with no coordinates at all", () => {
    expect(landmarks).toHaveLength(3100);
    expect(new Set(landmarks.map((r) => r.id)).size).toBe(3100);
    const none = landmarks.filter((r) => !r.game && !r.realWorld?.latLon).map((r) => r.id);
    expect(none).toHaveLength(60);
    expect(none.sort()).toEqual([...coverage.reconciliation.explanation.missingSixtyIds].sort());
    expect(landmarks.length - none.length).toBe(coverage.reconciliation.observedSnapshot.renderedLandmarkLayer);
  });

  it.skipIf(!hasAtlas)("all six datasets: 3282 in the database overview, 3222 renderable — the missing 60 are exactly the coordinate-less landmarks", () => {
    const atlas = JSON.parse(fs.readFileSync(atlasFile, "utf8"));
    expect(atlas.datasets).toEqual(["gtadb_landmarks", "sol_screenshots", "sol_leaks", "sol_trailer1", "sol_trailer2", "sol_trailer3"]);
    const rows = atlas.records.map((r: any[]) => ({ id: r[0], ds: atlas.datasets[r[1]], x: r[5], y: r[6], rw: !!r[7] }));
    expect(rows).toHaveLength(3282);
    const by = Object.fromEntries(atlas.datasets.map((d: string) => [d, rows.filter((r: any) => r.ds === d).length]));
    expect(by).toEqual({ gtadb_landmarks: 3100, sol_screenshots: 47, sol_leaks: 42, sol_trailer1: 30, sol_trailer2: 26, sol_trailer3: 37 });
    const renderable = rows.filter((r: any) => r.x != null || r.rw);
    expect(renderable).toHaveLength(3222);
    const missing = rows.filter((r: any) => r.x == null && !r.rw).map((r: any) => r.id).sort();
    expect(missing).toEqual([...coverage.reconciliation.explanation.missingSixtyIds].sort());
  });

  it("the 166-entry media tab is a different thing from the 47 screenshot pins", () => {
    const m = coverage.reconciliation.media.sourceScreenshotsTabEntries;
    expect(m.observed).toBe(166);
    expect(coverage.datasets.sol_screenshots.raw).toBe(47);
    expect(m.status).toBe("pending_permission");
  });

  it("every asset in the coverage report has an explicit status", () => {
    const allowed = new Set(["imported", "linked", "pending_permission", "unavailable"]);
    expect(coverage.assets.length).toBeGreaterThan(5);
    for (const a of coverage.assets) {
      expect(allowed, `${a.id}: ${a.status}`).toContain(a.status);
      expect(a.reason, a.id).toBeTruthy();
      expect(a.rights, a.id).toBeTruthy();
    }
  });

  it("L588 fixture: right record, coordinates, evidence and tag", () => {
    const r = landmarks.find((x) => x.id === "L588");
    expect(r.label).toBe("?, La Perle, Vice City");
    expect(r.tags).toContain("l1");
    expect(r.game).toEqual([-735, 1493]);
    expect(r.realWorld.address).toMatch(/71st St/);
    expect(r.media.map((m: any) => m.kind)).toEqual(expect.arrayContaining(["game_photo", "real_world_photo"]));
    // Linked media point at the pinned CC BY repository commit, never the live GTADB service.
    for (const m of r.media) expect(m.sourceUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/rolux\/gtadb\.org\/[0-9a-f]{40}\//);
  });

  it("no record links to the live GTADB service as an asset backend", () => {
    for (const r of landmarks) for (const m of r.media) expect(m.localUrl ?? "", r.id).not.toMatch(/gtadb\.org/);
  });
});
