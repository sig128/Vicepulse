/**
 * Compares the bundled GTADB `yanis,16` zoom-1 overview against State of Leonida's
 * YANIS v16.0 zoom-2 tiles (local comparison cache, not redistributed).
 *
 * Both rasters are placed into game coordinates through their own transforms:
 *   GTADB:  px = (x + 16384) * 2^z / 32 - tileOrigin*256      (z = 1, tile origin 1)
 *   SoL:    px = (x - west) * width / (east - west) / 2^(6 - z) (z = 2, CRS from data/maps/yanis.json)
 * The script renders a side-by-side, a 50% blend and an absolute difference image,
 * then measures the best residual offset with a small brute-force search.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { GTADB_OVERVIEW, gameToOverview, solTransformFromConfig, gameToRaster } from "../packages/shared/src/coordinates.ts";

const root = path.resolve(import.meta.dirname, "..");
const cacheDir = path.join(root, "data/cache/stateofleonida");
const outDir = path.join(root, "docs/validation");
fs.mkdirSync(outDir, { recursive: true });

const solConfig = JSON.parse(fs.readFileSync(path.join(cacheDir, "raw/maps/yanis.json"), "utf8"));
const v16 = solConfig.versions.find((v: { id: string }) => v.id === "v16.0");
const solZ = 2;
const sol = solTransformFromConfig(v16, solConfig.maxNativeZoom, solZ);

const tilesDir = path.join(cacheDir, "compare-tiles");
const cols = 6, rows = 5;
const composites: sharp.OverlayOptions[] = [];
for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
  const f = path.join(tilesDir, `2_${x}_${y}.png`);
  if (fs.existsSync(f)) composites.push({ input: f, left: x * 256, top: y * 256 });
}
const solW = cols * 256, solH = rows * 256;
const solImg = await sharp({ create: { width: solW, height: solH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites).png().toBuffer();
await sharp(solImg).toFile(path.join(cacheDir, "sol-v16-z2-stitched.png"));

// Place GTADB overview into SoL's raster frame: game origin of overview pixel (0,0).
const ovGame = { x: GTADB_OVERVIEW.originX, y: GTADB_OVERVIEW.originY };
const [ox, oy] = gameToRaster(ovGame.x, ovGame.y, sol);
const scale = GTADB_OVERVIEW.unitsPerPixel / sol.unitsPerPixel;
const ovPath = path.join(root, "research/community-data/YANIS-community-map.png");
const ovSize = Math.round(GTADB_OVERVIEW.width * scale);
const ovResized = await sharp(ovPath).resize(ovSize, ovSize, { kernel: "nearest" }).png().toBuffer();

async function placeOverview(dx: number, dy: number) {
  const left = Math.round(ox + dx), top = Math.round(oy + dy);
  // Crop the part of the overview that falls inside SoL frame
  const cropL = Math.max(0, -left), cropT = Math.max(0, -top);
  const w = Math.min(ovSize - cropL, solW - Math.max(0, left));
  const h = Math.min(ovSize - cropT, solH - Math.max(0, top));
  const piece = await sharp(ovResized).extract({ left: cropL, top: cropT, width: w, height: h }).png().toBuffer();
  return sharp({ create: { width: solW, height: solH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }]).raw().toBuffer();
}

const solRaw = await sharp(solImg).raw().toBuffer();
// Score only the land/coast area: compare luminance over a central window.
const win = { x0: 380, x1: 1080, y0: 120, y1: 1180 };
async function score(dx: number, dy: number) {
  const ov = await placeOverview(dx, dy);
  let sum = 0, n = 0;
  for (let y = win.y0; y < win.y1; y += 2) for (let x = win.x0; x < win.x1; x += 2) {
    const i = (y * solW + x) * 4;
    if (solRaw[i + 3] < 200 || ov[i + 3] < 200) continue;
    const a = 0.3 * solRaw[i] + 0.59 * solRaw[i + 1] + 0.11 * solRaw[i + 2];
    const b = 0.3 * ov[i] + 0.59 * ov[i + 1] + 0.11 * ov[i + 2];
    sum += Math.abs(a - b); n++;
  }
  return n ? sum / n : Infinity;
}

const results: { dx: number; dy: number; meanAbsLumaDiff: number }[] = [];
for (let dy = -6; dy <= 6; dy += 1) for (let dx = -6; dx <= 6; dx += 1) {
  results.push({ dx, dy, meanAbsLumaDiff: await score(dx, dy) });
}
results.sort((a, b) => a.meanAbsLumaDiff - b.meanAbsLumaDiff);
const best = results[0];
const atZero = results.find((r) => r.dx === 0 && r.dy === 0)!;

const ovAtZero = await placeOverview(0, 0);
const blend = Buffer.alloc(solRaw.length);
const diff = Buffer.alloc(solRaw.length);
for (let i = 0; i < solRaw.length; i += 4) {
  for (let c = 0; c < 3; c++) {
    blend[i + c] = (solRaw[i + c] + ovAtZero[i + c]) >> 1;
    diff[i + c] = Math.min(255, Math.abs(solRaw[i + c] - ovAtZero[i + c]) * 2);
  }
  blend[i + 3] = 255; diff[i + 3] = 255;
}
await sharp(blend, { raw: { width: solW, height: solH, channels: 4 } }).png().toFile(path.join(outDir, "registration-blend-sol-v16-vs-gtadb-yanis16.png"));
await sharp(diff, { raw: { width: solW, height: solH, channels: 4 } }).png().toFile(path.join(outDir, "registration-diff-sol-v16-vs-gtadb-yanis16.png"));
const sideBySide = await sharp({ create: { width: solW * 2, height: solH, channels: 4, background: "#000" } })
  .composite([{ input: solImg, left: 0, top: 0 }, { input: await sharp(ovAtZero, { raw: { width: solW, height: solH, channels: 4 } }).png().toBuffer(), left: solW, top: 0 }])
  .png().toBuffer();
await sharp(sideBySide).resize(solW, Math.round(solH / 2)).png().toFile(path.join(outDir, "registration-side-by-side.png"));

const report = {
  generatedAt: new Date().toISOString(),
  compared: {
    a: { id: "stateofleonida:YANIS:v16.0", zoom: solZ, unitsPerPixel: sol.unitsPerPixel, origin: [sol.originX, sol.originY], bounds: v16.bounds, originalSize: v16.originalSize, tiles: composites.length },
    b: { id: "gtadb:yanis,16:z1-overview", unitsPerPixel: GTADB_OVERVIEW.unitsPerPixel, origin: [GTADB_OVERVIEW.originX, GTADB_OVERVIEW.originY], sha256: GTADB_OVERVIEW.sha256 },
  },
  predictedOverviewOffsetInSolFrame: [ox, oy],
  meanAbsLumaDiffAtPredictedOffset: atZero.meanAbsLumaDiff,
  bestResidualOffsetPx: { dx: best.dx, dy: best.dy, meanAbsLumaDiff: best.meanAbsLumaDiff },
  bestResidualOffsetGameUnits: { dx: best.dx * sol.unitsPerPixel, dy: -best.dy * sol.unitsPerPixel },
  top5: results.slice(0, 5),
  interpretation: "",
};
report.interpretation = best.dx === 0 && best.dy === 0
  ? "Predicted transforms align at 1 px (16 game units) resolution; remaining difference is artwork/revision content, see diff image."
  : `Best match is offset by (${best.dx}, ${best.dy}) px from the predicted registration; inspect the diff image before treating the rasters as interchangeable.`;
fs.writeFileSync(path.join(outDir, "registration-sol-v16-vs-gtadb.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
