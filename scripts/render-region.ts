/**
 * Render a game-space rectangle from cached GTADB tiles, with optional pins.
 *   tsx scripts/render-region.ts --rect=-3000,-1500,2500,4000 --z=3 --out=docs/validation/vice-city.png [--pins=L588,L1] [--all-pins] [--graph]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { P, readJson } from "./lib/paths.ts";
import { gtadbGlobalPixel, GTADB } from "../packages/shared/src/coordinates.ts";

export async function renderRegion(opts: {
  rect: [number, number, number, number]; z: number; out: string;
  pins?: { id: string; x: number; y: number; color?: string; label?: string }[];
  lines?: { a: [number, number]; b: [number, number]; color?: string; dashed?: boolean }[];
}) {
  const { rect: [minX, minY, maxX, maxY], z } = opts;
  const [gx0, gy0] = gtadbGlobalPixel(minX, maxY, z);
  const [gx1, gy1] = gtadbGlobalPixel(maxX, minY, z);
  const W = Math.round(gx1 - gx0), H = Math.round(gy1 - gy0);
  const ts = GTADB.tileSize;
  const comps: sharp.OverlayOptions[] = [];
  for (let ty = Math.floor(gy0 / ts); ty <= Math.floor(gy1 / ts); ty++) for (let tx = Math.floor(gx0 / ts); tx <= Math.floor(gx1 / ts); tx++) {
    const f = path.join(P.tiles, "yanis,16", String(z), `${z},${ty},${tx}.jpg`);
    if (!fs.existsSync(f)) continue;
    const left = Math.round(tx * ts - gx0), top = Math.round(ty * ts - gy0);
    // sharp requires overlays inside the canvas: crop the tile when it hangs over an edge
    const cl = Math.max(0, -left), ct = Math.max(0, -top);
    const cw = Math.min(ts - cl, W - Math.max(0, left)), ch = Math.min(ts - ct, H - Math.max(0, top));
    if (cw <= 0 || ch <= 0) continue;
    comps.push({ input: await sharp(f).extract({ left: cl, top: ct, width: cw, height: ch }).toBuffer(), left: Math.max(0, left), top: Math.max(0, top) });
  }
  const px = (x: number, y: number) => { const [a, b] = gtadbGlobalPixel(x, y, z); return [a - gx0, b - gy0]; };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  for (const l of opts.lines ?? []) {
    const [ax, ay] = px(...l.a), [bx, by] = px(...l.b);
    svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${l.color ?? "#ff4fac"}" stroke-width="4" ${l.dashed ? 'stroke-dasharray="10 6"' : ""}/>`;
  }
  for (const p of opts.pins ?? []) {
    const [x, y] = px(p.x, p.y);
    svg += `<circle cx="${x}" cy="${y}" r="5" fill="${p.color ?? "#ff4fac"}" stroke="#000" stroke-width="1.5"/>`;
    if (p.label) svg += `<text x="${x + 7}" y="${y + 4}" font-family="Helvetica" font-size="12" font-weight="bold" fill="#000" stroke="#fff" stroke-width="3" paint-order="stroke">${p.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
  }
  svg += `</svg>`;
  comps.push({ input: Buffer.from(svg), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 3, background: "#2c68a6" } }).composite(comps).png().toFile(opts.out);
  return { W, H };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const rect = arg("rect")!.split(",").map(Number) as [number, number, number, number];
  const records = readJson<any[]>(path.join(P.normalized, "gtadb-landmarks.json"));
  const ids = new Set((arg("pins") ?? "").split(",").filter(Boolean));
  const all = process.argv.includes("--all-pins");
  const pins = records.filter((r) => r.game && (all || ids.has(r.id)) && r.game[0] >= rect[0] && r.game[0] <= rect[2] && r.game[1] >= rect[1] && r.game[1] <= rect[3])
    .map((r) => ({ id: r.id, x: r.game[0], y: r.game[1], label: all ? r.id : `${r.id} ${r.label}` }));
  let lines: { a: [number, number]; b: [number, number]; dashed?: boolean }[] = [];
  if (process.argv.includes("--graph")) {
    const g = readJson<any>(path.join(path.resolve(import.meta.dirname, ".."), "data/scenarios/night-shift.json"));
    const nodes = Object.fromEntries(g.routeGraph.nodes.map((n: any) => [n.id, n]));
    lines = g.routeGraph.edges.map((e: any) => ({ a: nodes[e.from].game, b: nodes[e.to].game, dashed: true }));
    for (const n of g.routeGraph.nodes) pins.push({ id: n.id, x: n.game[0], y: n.game[1], label: n.id });
  }
  const r = await renderRegion({ rect, z: Number(arg("z") ?? 3), out: arg("out")!, pins, lines });
  console.log(r);
}
