/**
 * Visual + statistical registration evidence for the GTADB overview transform.
 * Outputs docs/validation/control-points.png and docs/validation/registration-stats.json.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { P, readJson, writeJson } from "./lib/paths.ts";
import { loadOverview, landFraction, isLandNear, OVERVIEW_FILE } from "./lib/landmask.ts";
import { gameToOverview } from "../packages/shared/src/coordinates.ts";

export const CONTROL_POINTS = [
  { id: "L588", expect: "land", why: "Primary fixture, La Perle (Vice City)" },
  { id: "L689", expect: "land", why: "Container crane, Port Vice City (east)" },
  { id: "L13", expect: "land", why: "Hotel, Washington Beach (far east barrier island)" },
  { id: "L281", expect: "land", why: "Raceway, Port Gellhorn (west)" },
  { id: "L399", expect: "land", why: "Sugar mill, Ambrosia (centre-north)" },
  { id: "L530", expect: "land", why: "Mount Kalaga (north interior)" },
  { id: "L625", expect: "near_land", why: "Visitor centre, Grassrivers marsh (south-centre). YANIS draws the marsh in water tones; land sliver within 2 px" },
  { id: "L273", expect: "land", why: "Radar station, Leonida Keys (south)" },
  { id: "L1560", expect: "land", why: "Airfield, Lummox County (far north)" },
  { id: "L1556", expect: "water", why: "Negative control: 'Gulf of Leonida' label" },
] as const;

const records = readJson<any[]>(path.join(P.normalized, "gtadb-landmarks.json"));
const byId = new Map(records.map((r) => [r.id, r]));
const img = await loadOverview();

const cp = CONTROL_POINTS.map((c) => {
  const r = byId.get(c.id);
  const [px, py] = gameToOverview(r.game[0], r.game[1]);
  const land = isLandNear(img, px, py, 1);
  const observed = land ? "land" : isLandNear(img, px, py, 2) ? "near_land" : "water";
  const pass = c.expect === "near_land" ? observed !== "water" : observed === c.expect;
  return { ...c, label: r.label, game: r.game, overviewPx: [px, py], observed, pass };
});

const pts = records.filter((r) => r.game).map((r) => r.game as [number, number]);
const offsets: { dx: number; dy: number; landFraction: number }[] = [];
for (const d of [-24, -12, -6, -3, 0, 3, 6, 12, 24]) {
  offsets.push({ dx: d, dy: 0, landFraction: landFraction(img, pts, (x, y) => { const [a, b] = gameToOverview(x, y); return [a + d, b]; }) });
  if (d !== 0) offsets.push({ dx: 0, dy: d, landFraction: landFraction(img, pts, (x, y) => { const [a, b] = gameToOverview(x, y); return [a, b + d]; }) });
}
const flippedY = landFraction(img, pts, (x, y) => gameToOverview(x, -y));
const swapped = landFraction(img, pts, (x, y) => gameToOverview(y, x));
offsets.sort((a, b) => b.landFraction - a.landFraction);

const stats = {
  generatedAt: new Date().toISOString(),
  transform: "overviewX = (x + 16384) / 16 - 256 ; overviewY = (16384 - y) / 16 - 256",
  controlPoints: cp,
  landFractionAllPins: { atTransform: offsets.find((o) => o.dx === 0 && o.dy === 0)!.landFraction, best: offsets[0], flippedY, swappedAxes: swapped, offsets },
  note: "A numeric round trip does not prove alignment; these checks sample the actual raster. Pins at 16 units/px are tested on the exact pixel (no neighbourhood) for the statistical run.",
};
writeJson(path.join(P.docs, "validation/registration-stats.json"), stats);

// Contact sheet: 5 x 2 crops at 6x with crosshair
const tile = 192, scale = 6, half = tile / scale / 2;
const comps: sharp.OverlayOptions[] = [];
for (const [i, c] of cp.entries()) {
  const [px, py] = c.overviewPx;
  const left = Math.max(0, Math.round(px - half)), top = Math.max(0, Math.round(py - half));
  const crop = await sharp(OVERVIEW_FILE).extract({ left, top, width: half * 2, height: half * 2 }).resize(tile, tile, { kernel: "nearest" }).toBuffer();
  const cx = (px - left) * scale, cy = (py - top) * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile + 34}">
    <line x1="${cx}" y1="0" x2="${cx}" y2="${tile}" stroke="#ff4fac" stroke-width="1.5"/>
    <line x1="0" y1="${cy}" x2="${tile}" y2="${cy}" stroke="#ff4fac" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="#000" stroke-width="2"/>
    <rect y="${tile}" width="${tile}" height="34" fill="#06090f"/>
    <text x="6" y="${tile + 14}" font-family="Helvetica" font-size="12" fill="${c.pass ? "#49eaf5" : "#ff674f"}">${c.id} ${c.pass ? "PASS" : "FAIL"} (${c.observed})</text>
    <text x="6" y="${tile + 28}" font-family="Helvetica" font-size="10" fill="#a5b2c4">${c.label.replace(/&/g, "&amp;").slice(0, 34)}</text></svg>`;
  const x = (i % 5) * tile, y = Math.floor(i / 5) * (tile + 34);
  comps.push({ input: crop, left: x, top: y }, { input: Buffer.from(svg), left: x, top: y });
}
await sharp({ create: { width: tile * 5, height: (tile + 34) * 2, channels: 3, background: "#06090f" } }).composite(comps).png().toFile(path.join(P.docs, "validation/control-points.png"));
console.log(JSON.stringify({ controlPoints: cp.map((c) => `${c.id}:${c.pass ? "pass" : "FAIL"}`), land: stats.landFractionAllPins.atTransform, best: offsets[0], flippedY, swapped }, null, 1));
if (!fs.existsSync(path.join(P.docs, "validation"))) process.exit(1);
