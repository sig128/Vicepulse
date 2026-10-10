/**
 * Map revisions, transforms and tile cache.
 *
 *   pnpm map:prepare                         write manifests only
 *   pnpm map:tiles                           download GTADB yanis,16 tiles z1..3 (budget 600) from the pinned GitHub commit
 *   tsx scripts/prepare-map.ts --download --max-zoom=4 --budget=1200
 *
 * Tiles come from raw.githubusercontent.com at GTADB_COMMIT (upstream asks users to sync via GitHub,
 * not to hotlink maps.gtadb.org). Downloads are serial-ish (concurrency 4), cached, and bounded.
 */
import fs from "node:fs";
import path from "node:path";
import { P, GTADB_COMMIT, GTADB_REPO, sha256, readJson, writeJson } from "./lib/paths.ts";
import { GTADB, GTADB_OVERVIEW, GTADB_LEGEND_CLIP, gtadbTileGameRect, solTransformFromConfig } from "../packages/shared/src/coordinates.ts";

const argv = process.argv.slice(2);
const DOWNLOAD = argv.includes("--download");
const MAX_ZOOM = Number(argv.find((a) => a.startsWith("--max-zoom="))?.split("=")[1] ?? 3);
const BUDGET = Number(argv.find((a) => a.startsWith("--budget="))?.split("=")[1] ?? 600);

const TILESET = "yanis,16";
const tileDir = (z: number) => path.join(P.tiles, TILESET, String(z));
export const tileUrl = (z: number, x: number, y: number) =>
  `https://raw.githubusercontent.com/${GTADB_REPO}/${GTADB_COMMIT}/maps/tiles/6/${encodeURIComponent(TILESET)}/${z}/${z},${y},${x}.jpg`;

/** Tiles entirely inside the artwork legend column carry no geography; skip them. */
function tileIsLegendOnly(z: number, x: number, y: number) {
  const r = gtadbTileGameRect(z, x, y);
  return r.minX >= GTADB_LEGEND_CLIP.minX && r.minY >= GTADB_LEGEND_CLIP.minY;
}

async function downloadTiles() {
  let spent = 0, cached = 0, failed = 0, skippedLegend = 0;
  const queue: [number, number, number][] = [];
  for (let z = 1; z <= MAX_ZOOM; z++) {
    const [[x0, y0], [x1, y1]] = GTADB.yanis16Ranges[z];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (tileIsLegendOnly(z, x, y)) { skippedLegend++; continue; }
      const f = path.join(tileDir(z), `${z},${y},${x}.jpg`);
      if (fs.existsSync(f)) { cached++; continue; }
      queue.push([z, x, y]);
    }
  }
  console.log(`tiles: ${cached} cached, ${queue.length} missing, ${skippedLegend} legend-only skipped; budget ${BUDGET}`);
  const work = queue.slice(0, BUDGET);
  let i = 0;
  async function worker() {
    while (i < work.length) {
      const [z, x, y] = work[i++];
      const res = await fetch(tileUrl(z, x, y));
      spent++;
      if (!res.ok) { failed++; continue; }
      fs.mkdirSync(tileDir(z), { recursive: true });
      fs.writeFileSync(path.join(tileDir(z), `${z},${y},${x}.jpg`), Buffer.from(await res.arrayBuffer()));
      if (spent % 50 === 0) console.log(`  ${spent}/${work.length}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`downloaded ${spent - failed}, failed ${failed}, remaining beyond budget ${Math.max(0, queue.length - BUDGET)}`);
}

if (DOWNLOAD) await downloadTiles();

// ---------------------------------------------------------------------------
// Tile inventory + checksums
// ---------------------------------------------------------------------------
const inventory: Record<string, { expected: number; legendOnly: number; cached: number }> = {};
const checksums: Record<string, string> = {};
for (let z = 0; z <= 6; z++) {
  const [[x0, y0], [x1, y1]] = GTADB.yanis16Ranges[z];
  let expected = 0, legendOnly = 0, cachedCount = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    expected++;
    if (tileIsLegendOnly(z, x, y)) legendOnly++;
    const f = path.join(tileDir(z), `${z},${y},${x}.jpg`);
    if (fs.existsSync(f)) { cachedCount++; if (z <= 2) checksums[`${z},${y},${x}`] = sha256(fs.readFileSync(f)); }
  }
  inventory[z] = { expected, legendOnly, cached: cachedCount };
}

// ---------------------------------------------------------------------------
// Revision manifest
// ---------------------------------------------------------------------------
const overviewPath = path.join(P.research, "community-data/YANIS-community-map.png");
const overviewHash = sha256(fs.readFileSync(overviewPath));
if (overviewHash !== GTADB_OVERVIEW.sha256) throw new Error(`Overview checksum mismatch: ${overviewHash}`);

const solMapsDir = path.join(P.solRaw, "maps");
const solYanis = fs.existsSync(path.join(solMapsDir, "yanis.json")) ? readJson<any>(path.join(solMapsDir, "yanis.json")) : null;
const solRick = fs.existsSync(path.join(solMapsDir, "rickrick.json")) ? readJson<any>(path.join(solMapsDir, "rickrick.json")) : null;
const solDupz = fs.existsSync(path.join(solMapsDir, "dupz0r.json")) ? readJson<any>(path.join(solMapsDir, "dupz0r.json")) : null;
const solRockstar = fs.existsSync(path.join(solMapsDir, "rockstar.json")) ? readJson<any>(path.join(solMapsDir, "rockstar.json")) : null;
const registration = fs.existsSync(path.join(P.docs, "validation/registration-sol-v16-vs-gtadb.json"))
  ? readJson<any>(path.join(P.docs, "validation/registration-sol-v16-vs-gtadb.json")) : null;

function solRevisions(cfg: any, layer: string) {
  if (!cfg) return { status: "pending_retrieval", reason: "data/maps/*.json not cached; run pnpm data:fetch-sol" };
  return {
    layer, currentVersion: cfg.currentVersion ?? null, maxNativeZoom: cfg.maxNativeZoom, maxZoom: cfg.maxZoom,
    versions: cfg.versions.map((v: any) => {
      let transform: unknown = null, transformError: string | null = null;
      try { transform = solTransformFromConfig(v, cfg.maxNativeZoom ?? 6, cfg.maxNativeZoom ?? 6); } catch (e) { transformError = String(e); }
      return {
        id: v.id, name: v.name, date: v.date, originalSize: v.originalSize, bounds: v.bounds,
        variants: [
          "normal",
          ...(v.alternateScheme ? ["dark"] : []),
          ...(v.noCamsTileUrl ? ["nocams"] : []),
          ...(v.alternateScheme?.noCamsTileUrl ? ["nocams-dark"] : []),
        ],
        nativeTransform: transform, transformError,
        assetStatus: "linked",
        assetNote: "Tiles hosted by State of Leonida; redistribution rights not established. Compared locally only.",
      };
    }),
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  primaryReference: {
    site: "https://map.stateofleonida.net/?marker=L588",
    activeRevision: solYanis ? { layer: "YANIS", version: solYanis.currentVersion, date: solYanis.versions.find((v: any) => v.id === solYanis.currentVersion)?.date } : null,
    note: "Primary reference revision as configured by the source at inspection. Its tiles are not redistributed by this project.",
  },
  renderedBasemap: {
    id: "gtadb:yanis,16",
    tileSet: TILESET,
    upstreamDirectoryLabel: "yanis,16",
    artworkLabel: "V17 (WIP)",
    labelMismatch: "Repository directory says yanis,16; the artwork legend says V17 (WIP). Both values preserved.",
    repo: `https://github.com/${GTADB_REPO}`,
    commit: GTADB_COMMIT,
    commitNote: "Bundled overview's own acquisition commit is unknown; tiles fetched by this script come from the commit above.",
    license: "CC BY 4.0 — GTA VI Map Tiles — https://map.gtadb.org; YANIS / GTA VI Mapping Community; gtadb.org and all contributors",
    changes: "36 zoom-1 tiles stitched to a 1536 px overview (research pack); display crop excludes the legend column; Afterdark mode applies a colour treatment in-shader. No geometry edited.",
    transform: {
      formula: "globalPixel = (x + 16384, 16384 - y) * 1024 * 2^z / 32768",
      mapW: GTADB.mapW, mapH: GTADB.mapH, zeroX: GTADB.zeroX, zeroY: GTADB.zeroY, tileSize: GTADB.tileSize,
      tileRanges: GTADB.yanis16Ranges,
    },
    overview: { file: "research/community-data/YANIS-community-map.png", sha256: overviewHash, ...GTADB_OVERVIEW },
    legendClip: GTADB_LEGEND_CLIP,
    tileInventory: inventory,
    tileChecksumsZ0toZ2: checksums,
  },
  registrationAgainstPrimary: registration
    ? { method: "scripts/compare-registration.ts", result: registration.bestResidualOffsetPx, resolutionGameUnits: registration.compared?.a?.unitsPerPixel, interpretation: registration.interpretation,
        contentDifferences: "Coastline and road geometry co-register; road styling, labels, legend placement (left in SoL v16.0, right in GTADB V17 WIP) and the Leonida Keys airfield differ. Treat as different artwork revisions in the same frame.",
        artifacts: ["docs/validation/registration-blend-sol-v16-vs-gtadb-yanis16.png", "docs/validation/registration-diff-sol-v16-vs-gtadb-yanis16.png", "docs/validation/registration-side-by-side.png"] }
    : { status: "not_run", how: "pnpm map:compare (requires local comparison tiles)" },
  sourceLayers: {
    YANIS: solRevisions(solYanis, "YANIS"),
    RickRick: solRevisions(solRick, "RickRick"),
    DuPz0r: { ...solRevisions(solDupz, "DuPz0r"), note: "Source config lists two entries with the same id v8.0 and different originalSize; preserved as published." },
  },
  historicalComparisons: solRockstar
    ? Object.values(solRockstar).map((l: any) => ({
        id: l.id, name: l.name, bounds: l.bounds, defaultOpacity: l.opacity, sourceAsset: l.imageUrl,
        scaleAssumption: "Bounds as configured by the source client, in GTA VI game units; equal-scale alignment between different games is the source's assumption, not a measured fact.",
        assetStatus: "pending_permission",
        localSlot: `apps/web/public/assets/maps/compare/${l.id}.(png|svg)`,
      }))
    : [],
};

writeJson(path.join(P.manifests, "map-revisions.json"), manifest);

fs.mkdirSync(path.join(P.webGenerated), { recursive: true });
writeJson(path.join(P.webGenerated, "map-manifest.json"), {
  renderedBasemap: { ...manifest.renderedBasemap, tileChecksumsZ0toZ2: undefined },
  primaryReference: manifest.primaryReference,
  registrationAgainstPrimary: manifest.registrationAgainstPrimary,
  sourceLayers: manifest.sourceLayers,
  historicalComparisons: manifest.historicalComparisons.map((c: any) => ({ ...c, localAvailable: ["png", "svg", "jpg", "webp"].some((ext) => fs.existsSync(path.join(path.dirname(P.webGenerated), "assets/maps/compare", `${c.id}.${ext}`))) })),
});
fs.copyFileSync(overviewPath, path.join(P.webGenerated, "yanis16-overview.png"));
console.log("map manifests written; tile inventory:", inventory);
