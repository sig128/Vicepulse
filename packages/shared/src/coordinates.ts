/**
 * Fictional game-space coordinates (GTADB / State of Leonida "lat = y, lng = x")
 * and every raster/scene transform derived from them.
 *
 * Game XY is NOT longitude/latitude. Real-world coordinates live in a separate
 * field and must never pass through these functions.
 */

export type GameXY = readonly [x: number, y: number];

/** Axis-aligned raster registration: north-up, uniform scale in both axes. */
export interface RasterTransform {
  id: string;
  /** Game X at the raster's left edge (pixel x = 0). */
  originX: number;
  /** Game Y at the raster's top edge (pixel y = 0). */
  originY: number;
  /** Game units per raster pixel. Same value on both axes (no aspect distortion). */
  unitsPerPixel: number;
  width: number;
  height: number;
}

export function gameToRaster(x: number, y: number, t: Pick<RasterTransform, "originX" | "originY" | "unitsPerPixel">): [number, number] {
  return [(x - t.originX) / t.unitsPerPixel, (t.originY - y) / t.unitsPerPixel];
}

export function rasterToGame(px: number, py: number, t: Pick<RasterTransform, "originX" | "originY" | "unitsPerPixel">): [number, number] {
  return [t.originX + px * t.unitsPerPixel, t.originY - py * t.unitsPerPixel];
}

// ---------------------------------------------------------------------------
// GTADB tile pyramid (reference/gtadb-maps.js: mapW = mapH = 32768, zero = 16384, 256 px tiles)
// ---------------------------------------------------------------------------

export const GTADB = {
  mapW: 32768,
  mapH: 32768,
  zeroX: 16384,
  zeroY: 16384,
  tileSize: 256,
  /** Inclusive [[x0, y0], [x1, y1]] tile ranges for tileSet "yanis,16" (reference/gtadb-maps.js). */
  yanis16Ranges: {
    0: [[0, 0], [3, 3]],
    1: [[1, 1], [6, 6]],
    2: [[2, 2], [12, 12]],
    3: [[5, 5], [25, 24]],
    4: [[10, 10], [51, 49]],
    5: [[21, 21], [103, 99]],
    6: [[42, 42], [206, 198]],
  } as Record<number, [[number, number], [number, number]]>,
} as const;

export function gtadbPixelsPerUnit(z: number): number {
  return (1024 * 2 ** z) / GTADB.mapW;
}

export function gtadbGlobalPixel(x: number, y: number, z: number): [number, number] {
  const k = gtadbPixelsPerUnit(z);
  return [(x + GTADB.zeroX) * k, (GTADB.zeroY - y) * k];
}

/** Game-space rectangle covered by one GTADB tile (tile filename `z,ty,tx.jpg`). */
export function gtadbTileGameRect(z: number, tx: number, ty: number) {
  const upp = 1 / gtadbPixelsPerUnit(z);
  const span = GTADB.tileSize * upp;
  const minX = tx * span - GTADB.zeroX;
  const maxY = GTADB.zeroY - ty * span;
  return { minX, maxX: minX + span, minY: maxY - span, maxY };
}

export function gtadbTileInRange(z: number, tx: number, ty: number): boolean {
  const r = GTADB.yanis16Ranges[z];
  if (!r) return false;
  return tx >= r[0][0] && tx <= r[1][0] && ty >= r[0][1] && ty <= r[1][1];
}

/**
 * The bundled 1536 x 1536 overview: zoom 1, tile columns/rows 1..6 inclusive.
 * overviewX = (x + 16384) / 16 - 256 ; overviewY = (16384 - y) / 16 - 256
 */
export const GTADB_OVERVIEW: RasterTransform & {
  tileSet: string;
  zoom: number;
  tileOrigin: [number, number];
  sha256: string;
  /** Geographic display crop, in full-image pixels (legend/reference column excluded). */
  crop: { x: number; y: number; width: number; height: number };
} = {
  id: "gtadb:yanis,16:z1",
  tileSet: "yanis,16",
  zoom: 1,
  tileOrigin: [1, 1],
  originX: 1 * 256 * 16 - 16384, // -12288
  originY: 16384 - 1 * 256 * 16, // 12288
  unitsPerPixel: 16,
  width: 1536,
  height: 1536,
  sha256: "588f5d7cccb6ec06c5237e54fe9847584659137f5c6035600be932c7b52f2761",
  // Legend/reference column begins at x ≈ 1016 and ends at y ≈ 1330 (measured, see docs/MAP_REGISTRATION.md).
  crop: { x: 0, y: 32, width: 1008, height: 1376 },
};

/** Game-space region occupied by the artwork legend column; raster tiles are clipped here. */
export const GTADB_LEGEND_CLIP = {
  minX: overviewToGameStatic(1012, 0)[0],
  maxY: overviewToGameStatic(0, -256)[1],
  minY: overviewToGameStatic(0, 1334)[1],
};

function overviewToGameStatic(px: number, py: number): [number, number] {
  return [(px + 256) * 16 - 16384, 16384 - (py + 256) * 16];
}

export function gameToOverview(x: number, y: number): [number, number] {
  return [(x + 16384) / 16 - 256, (16384 - y) / 16 - 256];
}

export function overviewToGame(px: number, py: number): [number, number] {
  return [(px + 256) * 16 - 16384, 16384 - (py + 256) * 16];
}

/** Overview pixel → crop-local pixel. The crop only translates; scale is unchanged. */
export function overviewToCrop(px: number, py: number, crop = GTADB_OVERVIEW.crop): [number, number] {
  return [px - crop.x, py - crop.y];
}

export function isInsideCrop(px: number, py: number, crop = GTADB_OVERVIEW.crop): boolean {
  return px >= crop.x && py >= crop.y && px < crop.x + crop.width && py < crop.y + crop.height;
}

// ---------------------------------------------------------------------------
// State of Leonida Leaflet CRS (createCustomCRS in the inspected client).
// At native zoom: pixelX = (lng - west) * width / (east - west); pixelY = (north - lat) * height / (north - south)
// ---------------------------------------------------------------------------

export interface SolVersionConfig {
  id: string;
  originalSize: { width: number; height: number };
  bounds: [[south: number, west: number], [north: number, east: number]];
}

export function solTransformFromConfig(v: SolVersionConfig, maxNativeZoom: number, z: number): RasterTransform {
  const [[south, west], [north, east]] = v.bounds;
  const sx = (east - west) / v.originalSize.width;
  const sy = (north - south) / v.originalSize.height;
  if (Math.abs(sx - sy) > 1e-9) {
    // Non-uniform registration would distort aspect. Surface it instead of silently averaging.
    throw new Error(`SoL ${v.id}: non-uniform units per pixel (${sx} vs ${sy})`);
  }
  const upp = sx * 2 ** (maxNativeZoom - z);
  return {
    id: `stateofleonida:${v.id}:z${z}`,
    originX: west,
    originY: north,
    unitsPerPixel: upp,
    width: Math.ceil(v.originalSize.width / 2 ** (maxNativeZoom - z)),
    height: Math.ceil(v.originalSize.height / 2 ** (maxNativeZoom - z)),
  };
}

// ---------------------------------------------------------------------------
// Scene space: [sceneX, height, sceneZ]. North (+game Y) is −Z, so raster Y (south-down)
// maps to +Z without a second flip.
// ---------------------------------------------------------------------------

export const SCENE_UNITS_PER_GAME_UNIT = 1 / 100;

export function gameToScene(x: number, y: number, height = 0): [number, number, number] {
  return [x * SCENE_UNITS_PER_GAME_UNIT, height, -y * SCENE_UNITS_PER_GAME_UNIT];
}

export function sceneToGame(sx: number, sz: number): [number, number] {
  return [sx / SCENE_UNITS_PER_GAME_UNIT, -sz / SCENE_UNITS_PER_GAME_UNIT];
}

export function overviewToScene(px: number, py: number, height = 0): [number, number, number] {
  const [x, y] = overviewToGame(px, py);
  return gameToScene(x, y, height);
}

export function sceneToOverview(sx: number, sz: number): [number, number] {
  const [x, y] = sceneToGame(sx, sz);
  return gameToOverview(x, y);
}

/** Scene-space rectangle (centre + size) covered by a raster. Used to place textured planes. */
export function rasterScenePlane(t: Pick<RasterTransform, "originX" | "originY" | "unitsPerPixel">, px: number, py: number, w: number, h: number) {
  const [x0, y0] = rasterToGame(px, py, t);
  const [x1, y1] = rasterToGame(px + w, py + h, t);
  const [ax, , az] = gameToScene(x0, y0);
  const [bx, , bz] = gameToScene(x1, y1);
  return { cx: (ax + bx) / 2, cz: (az + bz) / 2, width: bx - ax, depth: bz - az };
}

// ---------------------------------------------------------------------------
// Distance. Community convention: 1 game unit ≈ 1 metre (the YANIS/GTADB scale bar uses this).
// ---------------------------------------------------------------------------

export const METRES_PER_GAME_UNIT = 1;

export function gameDistance(a: GameXY, b: GameXY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function formatDistance(units: number, system: "metric" | "imperial"): string {
  const m = units * METRES_PER_GAME_UNIT;
  if (system === "imperial") {
    const mi = m / 1609.344;
    return mi < 0.2 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(2)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

export function isValidGameXY(v: unknown): v is GameXY {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

/** Bearing in degrees, 0 = north (+Y), clockwise. Matches SoL `motion.heading` convention (to be validated per record). */
export function headingVector(headingDeg: number): [number, number] {
  const r = (headingDeg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}
