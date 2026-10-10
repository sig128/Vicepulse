/** Prints water fraction per route-graph edge and whether each node is on land. `npx tsx scripts/route-report.ts` */
import fs from "node:fs";
import path from "node:path";
import { gameToOverview } from "../packages/shared/src/coordinates.ts";
import { loadOverview, isLandNear, waterFractionAlong } from "./lib/landmask.ts";
import { ROOT } from "./lib/paths.ts";

const sc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/scenarios/night-shift.json"), "utf8"));
const img = await loadOverview();
const nodes = new Map<string, any>(sc.routeGraph.nodes.map((n: any) => [n.id, n]));
for (const n of nodes.values()) {
  const [px, py] = gameToOverview(n.game[0], n.game[1]);
  console.log(`node ${n.id.padEnd(14)} ${String(n.game).padEnd(16)} px=${px.toFixed(0)},${py.toFixed(0)} land=${isLandNear(img, px, py, 2)}`);
}
for (const e of sc.routeGraph.edges) {
  const w = waterFractionAlong(img, nodes.get(e.from).game, nodes.get(e.to).game);
  console.log(`edge ${(e.from + "→" + e.to).padEnd(28)} ${e.crossing.padEnd(7)} water=${(w * 100).toFixed(0)}%${e.crossing === "land" && w > 0.12 ? "  <-- PROBLEM" : ""}`);
}
