import path from "node:path";
import sharp from "sharp";
import { ROOT } from "./paths.ts";
import { gameToOverview } from "../../packages/shared/src/coordinates.ts";

export const OVERVIEW_FILE = path.join(ROOT, "research/community-data/YANIS-community-map.png");

export interface Raster { data: Buffer; width: number; height: number; channels: number }

export async function loadOverview(): Promise<Raster> {
  const { data, info } = await sharp(OVERVIEW_FILE).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** YANIS water palette: saturated blues (deep #2C68A6 through shallow cyan). Land is white/grey/green/yellow. */
export function isWaterRGB(r: number, g: number, b: number) {
  return b > 120 && b > r + 45 && b >= g + 10;
}

export function pixelAt(img: Raster, px: number, py: number): [number, number, number] | null {
  const x = Math.round(px), y = Math.round(py);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Land if any pixel in a (2r+1)^2 window is land — pins sit on streets/buildings, which may be 1 px wide at 16 u/px. */
export function isLandNear(img: Raster, px: number, py: number, r = 1): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const c = pixelAt(img, px + dx, py + dy);
    if (c && !isWaterRGB(...c)) return true;
  }
  return false;
}

export function landFraction(img: Raster, points: [number, number][], transform: (x: number, y: number) => [number, number] = gameToOverview) {
  let land = 0, n = 0;
  for (const [x, y] of points) {
    const [px, py] = transform(x, y);
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
    n++;
    if (isLandNear(img, px, py, 0)) land++;
  }
  return n ? land / n : 0;
}

/** Fraction of samples along a straight game-space segment that fall on water in the overview. */
export function waterFractionAlong(img: Raster, a: [number, number], b: [number, number], step = 8) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / step));
  let water = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [px, py] = gameToOverview(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (!isLandNear(img, px, py, 1)) water++;
  }
  return water / (n + 1);
}
