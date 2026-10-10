import { describe, expect, it } from "vitest";
import {
  GTADB, GTADB_OVERVIEW, GTADB_LEGEND_CLIP, gameToOverview, overviewToGame, gameToScene, sceneToGame, gtadbTileGameRect,
  gtadbGlobalPixel, gtadbPixelsPerUnit, gtadbTileInRange, isInsideCrop, formatDistance, gameDistance, headingVector, solTransformFromConfig, gameToRaster, rasterToGame,
} from "@vicepulse/shared";

const samples: [number, number][] = [[0, 0], [-735, 1493], [-12288, 12288], [3839.5, -10239.5], [-5021.25, 7733.75], [2500, -8000]];

describe("shared transforms", () => {
  it("round-trips game ↔ overview pixels exactly", () => {
    for (const [x, y] of samples) {
      const [px, py] = gameToOverview(x, y);
      const [gx, gy] = overviewToGame(px, py);
      expect(gx).toBeCloseTo(x, 9);
      expect(gy).toBeCloseTo(y, 9);
    }
  });

  it("round-trips game ↔ scene and keeps north up (scene z = -y/100)", () => {
    for (const [x, y] of samples) {
      const [sx, sy, sz] = gameToScene(x, y, 2);
      expect(sy).toBe(2);
      expect(sz).toBeCloseTo(-y / 100, 12);
      const [gx, gy] = sceneToGame(sx, sz);
      expect(gx).toBeCloseTo(x, 9);
      expect(gy).toBeCloseTo(y, 9);
    }
  });

  it("uses the documented GTADB constants (32768 wide, centred, 256 px tiles)", () => {
    expect(GTADB.mapW).toBe(32768);
    expect(GTADB.zeroX).toBe(16384);
    expect(GTADB.tileSize).toBe(256);
    expect(gtadbPixelsPerUnit(0)).toBeCloseTo(1024 / 32768, 12);
    expect(gtadbPixelsPerUnit(3)).toBeCloseTo((1024 * 8) / 32768, 12);
  });

  it("overview is the z1 raster at 16 game units per pixel with origin (-12288, 12288)", () => {
    expect(GTADB_OVERVIEW.unitsPerPixel).toBe(16);
    expect(GTADB_OVERVIEW.originX).toBe(-12288);
    expect(GTADB_OVERVIEW.originY).toBe(12288);
    expect(gameToOverview(-12288, 12288)).toEqual([0, 0]);
    // Overview pixel = z1 global pixel minus the 256 px offset of tile column/row 1
    for (const [x, y] of samples) {
      const [gx, gy] = gtadbGlobalPixel(x, y, 1);
      const [px, py] = gameToOverview(x, y);
      expect(px).toBeCloseTo(gx - 256, 9);
      expect(py).toBeCloseTo(gy - 256, 9);
    }
  });

  it("tile rectangles tile the plane without gaps and agree with global pixels", () => {
    for (const z of [2, 3, 5]) {
      const a = gtadbTileGameRect(z, 10, 12), right = gtadbTileGameRect(z, 11, 12), below = gtadbTileGameRect(z, 10, 13);
      expect(right.minX).toBeCloseTo(a.maxX, 9);
      expect(below.maxY).toBeCloseTo(a.minY, 9);
      const [px, py] = gtadbGlobalPixel(a.minX, a.maxY, z);
      expect(px).toBeCloseTo(10 * 256, 6);
      expect(py).toBeCloseTo(12 * 256, 6);
    }
  });

  it("display crop maps to the documented game window and excludes the legend", () => {
    const c = GTADB_OVERVIEW.crop;
    expect(c).toMatchObject({ x: 0, y: 32, width: 1008, height: 1376 });
    const [minX, maxY] = overviewToGame(c.x, c.y);
    const [maxX, minY] = overviewToGame(c.x + c.width, c.y + c.height);
    expect([minX, maxX, minY, maxY]).toEqual([-12288, 3840, -10240, 11776]);
    // The legend panel starts east of the crop: nothing inside the crop can sample it.
    expect(GTADB_LEGEND_CLIP.minX).toBeGreaterThan(maxX);
    const [lx, ly] = gameToOverview(GTADB_LEGEND_CLIP.minX + 10, GTADB_LEGEND_CLIP.minY + 10);
    expect(isInsideCrop(lx, ly)).toBe(false);
    expect(isInsideCrop(...gameToOverview(-735, 1493))).toBe(true);
  });

  it("rejects tiles outside the published pyramid", () => {
    expect(gtadbTileInRange(1, 1, 1)).toBe(true);
    expect(gtadbTileInRange(1, -1, 1)).toBe(false);
    expect(gtadbTileInRange(2, 999, 0)).toBe(false);
  });

  it("generic raster transforms invert each other (used for SoL v16)", () => {
    const v16 = { id: "v16", originalSize: { width: 2000, height: 1500 }, bounds: [[11000 - 1500 * 16, -17000], [11000, -17000 + 2000 * 16]] as [[number, number], [number, number]] };
    const t = solTransformFromConfig(v16, 2, 2);
    expect(t).toMatchObject({ originX: -17000, originY: 11000, unitsPerPixel: 16 });
    expect(solTransformFromConfig(v16, 2, 1).unitsPerPixel).toBe(32);
    expect(() => solTransformFromConfig({ ...v16, originalSize: { width: 2000, height: 1400 } }, 2, 2)).toThrow(/non-uniform/);
    for (const [x, y] of samples) {
      const [px, py] = gameToRaster(x, y, t);
      const [gx, gy] = rasterToGame(px, py, t);
      expect(gx).toBeCloseTo(x, 6);
      expect(gy).toBeCloseTo(y, 6);
    }
  });

  it("measures in game units (1 unit ≈ 1 m) and formats km/mi", () => {
    expect(gameDistance([0, 0], [3000, 4000])).toBe(5000);
    expect(formatDistance(5000, "metric")).toBe("5.00 km");
    expect(formatDistance(1609.344, "imperial")).toMatch(/^1\.00 mi$/);
    expect(formatDistance(250, "metric")).toMatch(/250 m/);
  });

  it("headings follow the source convention (0° = north, clockwise)", () => {
    const [nx, ny] = headingVector(0);
    expect(nx).toBeCloseTo(0, 9); expect(ny).toBeCloseTo(1, 9);
    const [ex, ey] = headingVector(90);
    expect(ex).toBeCloseTo(1, 9); expect(ey).toBeCloseTo(0, 9);
  });
});
