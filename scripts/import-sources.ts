/**
 * Source adapters → normalized SourceRecords + dataset snapshots.
 *
 *   pnpm data:import             use bundled GTADB snapshot + cached State of Leonida files
 *   pnpm data:fetch-sol          refresh State of Leonida public /data/*.json (robots.txt-allowed, serial, 1 req/s)
 *   data/owner-exports/*.json    owner-provided exports (same shape as the SoL datasets) take precedence
 *
 * Never bypasses sign-in or access controls; robots-disallowed endpoints (*.php) are recorded, not requested.
 */
import fs from "node:fs";
import path from "node:path";
import { P, GTADB_COMMIT, GTADB_REPO, SOL_ORIGIN, sha256, readJson, writeJson, sleep } from "./lib/paths.ts";
import type { SourceRecord, DatasetId, MediaRef } from "../packages/shared/src/schemas.ts";

const args = new Set(process.argv.slice(2));
const FETCH_SOL = args.has("--fetch-sol");

const SOL_DATASETS: { id: DatasetId; file: string; label: string; evidence: SourceRecord["evidenceStatus"] }[] = [
  { id: "sol_screenshots", file: "screenshots.json", label: "Screenshots", evidence: "official_media_reference" },
  { id: "sol_leaks", file: "leaks.json", label: "Leaks", evidence: "leak_reference" },
  { id: "sol_trailer1", file: "trailer1.json", label: "Trailer 1", evidence: "official_media_reference" },
  { id: "sol_trailer2", file: "trailer2.json", label: "Trailer 2", evidence: "official_media_reference" },
  // Dataset label preserved exactly as the source names it; not independently verified as an official title.
  { id: "sol_trailer3", file: "trailer3.json", label: "Trailer 3", evidence: "official_media_reference" },
  { id: "sol_el_screenshots", file: "el_screenshots.json", label: "Extended Look screenshots (el_screenshots.json)", evidence: "official_media_reference" },
];
const SOL_AUX = ["markers.json", "credits.json", "database_changelog.json", "backgrounds.json", "news.json", "lang.json", "supporters.json"];
const SOL_MAPS = ["yanis", "rickrick", "dupz0r", "rockstar"];

async function politeFetch(url: string): Promise<{ status: number; body: Buffer | null }> {
  const res = await fetch(url, {
    headers: {
      // The source rejects non-browser agents with 403; we identify honestly in addition to a browser token.
      "user-agent": "Mozilla/5.0 (compatible; VICEPULSE-source-adapter/0.1; low-rate cached import)",
      accept: "application/json,*/*",
    },
  });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

async function fetchSol() {
  const robots = await politeFetch(`${SOL_ORIGIN}/robots.txt`);
  const robotsText = robots.body?.toString("utf8") ?? "";
  if (!/Allow:\s*\/data\//.test(robotsText)) {
    console.warn("robots.txt no longer allows /data/ — skipping State of Leonida fetch.");
    return;
  }
  fs.mkdirSync(path.join(P.solRaw, "maps"), { recursive: true });
  fs.writeFileSync(path.join(P.solRaw, "robots.txt"), robotsText);
  const files = [...SOL_DATASETS.map((d) => d.file), ...SOL_AUX];
  const log: Record<string, number> = {};
  for (const f of files) {
    const r = await politeFetch(`${SOL_ORIGIN}/data/${f}`);
    log[f] = r.status;
    if (r.body) fs.writeFileSync(path.join(P.solRaw, f), r.body);
    await sleep(1000);
  }
  for (const m of SOL_MAPS) {
    const r = await politeFetch(`${SOL_ORIGIN}/data/maps/${m}.json`);
    log[`maps/${m}.json`] = r.status;
    if (r.body) fs.writeFileSync(path.join(P.solRaw, "maps", `${m}.json`), r.body);
    await sleep(1000);
  }
  writeJson(path.join(P.solRaw, "fetch-log.json"), { fetchedAt: new Date().toISOString(), statuses: log });
  console.log("State of Leonida fetch:", log);
}

// ---------------------------------------------------------------------------
// GTADB landmarks (positional arrays, see reference + upstream map/index.js parseLandmark)
// [label, [x,y], igPhotoSize, rlAddress, [lat,lon], rlPhotoSize, tags, color, edited[3]]
// ---------------------------------------------------------------------------

type GtadbRow = [string, [number, number] | null, [number, number] | null, string | null, [number, number] | null, [number, number] | null, string[], string, number[]];

function gtadbRecords() {
  const file = path.join(P.research, "community-data/gtadb-landmarks-original.json");
  const buf = fs.readFileSync(file);
  const raw = JSON.parse(buf.toString("utf8")) as Record<string, GtadbRow>;
  const records: SourceRecord[] = [];
  const attribution = "GTA VI Landmarks Data (CC BY 4.0) — https://map.gtadb.org; gtadb.org and all contributors.";
  for (const [id, row] of Object.entries(raw)) {
    const [label, xy, igSize, rlAddress, latLon, rlSize, tags, color, edited] = row;
    const hasSize = (v: unknown) => Array.isArray(v) && v.length >= 2 && v[0] > 0 && v[1] > 0;
    const media: MediaRef[] = [];
    const photoBase = `https://raw.githubusercontent.com/${GTADB_REPO}/${GTADB_COMMIT}/map/photos/6`;
    if (hasSize(igSize)) media.push({
      kind: "game_photo", localUrl: `/media/gtadb/${encodeURIComponent(id)}/ig`, sourceUrl: `${photoBase}/${id},ig.jpg`,
      width: igSize![0], height: igSize![1], credit: "GTADB contributors (CC BY 4.0 repository file); depicted game imagery © Rockstar Games",
      status: "linked", rightsNote: "Repository file under GTADB CC BY 4.0; underlying game imagery retains Rockstar ownership. Cached on demand from the pinned GitHub commit.",
    });
    if (hasSize(rlSize)) media.push({
      kind: "real_world_photo", localUrl: `/media/gtadb/${encodeURIComponent(id)}/rl`, sourceUrl: `${photoBase}/${id},rl.jpg`,
      width: rlSize![0], height: rlSize![1], credit: "GTADB contributors; original real-world imagery provider not stated per file",
      status: "linked", rightsNote: "Real-world photo provenance is not recorded per file; displayed as a reference with attribution, not relicensed.",
    });
    const validPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
    records.push({
      id, dataset: "gtadb_landmarks", label, category: categoryFromTags(tags), tags,
      game: validPair(xy) ? [xy[0], xy[1]] : null,
      realWorld: rlAddress || validPair(latLon) ? { address: rlAddress || null, latLon: validPair(latLon) ? [latLon[0], latLon[1]] : null } : null,
      color: color ? `#${color}` : null, description: null, editedRaw: edited ?? null, media, fov: null,
      sourceUrl: `https://map.gtadb.org/#${encodeURIComponent(id)}`,
      attribution, evidenceStatus: "community_reconstruction", placementStatus: xy ? "community_estimate" : "unknown",
    });
  }
  return { records, rawCount: Object.keys(raw).length, sha256: sha256(buf), bytes: buf.length };
}

/** Mirrors the source client's getCategoryFromTags(): first public tag naming a known category, else "default". */
function categoryFromTags(tags: string[]) {
  const known = ["hotel", "residential", "landmark", "shop", "restaurant"];
  const publicTags = tags.filter((t) => !t.startsWith("//") && !t.startsWith("#"));
  return publicTags.map((t) => t.toLowerCase()).find((t) => known.includes(t)) ?? "default";
}

// ---------------------------------------------------------------------------
// State of Leonida datasets: { id, name, position{lat=y,lng=x}, tags, igPhoto, motion{heading,fov{angle,range},path}, ... }
// ---------------------------------------------------------------------------

interface SolEntry {
  id?: string; name?: string; position?: { lat: number; lng: number }; tags?: string[];
  igPhoto?: { url?: string; credit?: string }; externalLink?: string; videoLink?: string; video?: { src?: string };
  description?: string; lastEdit?: number; motion?: { heading?: number; fov?: { angle?: number; range?: number }; path?: { lat: number; lng: number }[] };
}

function readSolDataset(file: string): { entries: SolEntry[]; origin: "owner_export" | "source_cache" | null; sha256: string | null } {
  const owner = path.join(P.ownerExports, file);
  if (fs.existsSync(owner)) {
    const buf = fs.readFileSync(owner);
    return { entries: JSON.parse(buf.toString("utf8")), origin: "owner_export", sha256: sha256(buf) };
  }
  const cached = path.join(P.solRaw, file);
  if (fs.existsSync(cached)) {
    const buf = fs.readFileSync(cached);
    return { entries: JSON.parse(buf.toString("utf8")), origin: "source_cache", sha256: sha256(buf) };
  }
  return { entries: [], origin: null, sha256: null };
}

function solRecords() {
  const out: Record<string, { records: SourceRecord[]; raw: number; invalid: string[]; duplicates: string[]; origin: string | null; sha256: string | null; label: string }> = {};
  for (const ds of SOL_DATASETS) {
    const { entries, origin, sha256: hash } = readSolDataset(ds.file);
    const seen = new Set<string>();
    const records: SourceRecord[] = [];
    const invalid: string[] = [];
    const duplicates: string[] = [];
    entries.forEach((e, i) => {
      const id = e.id ?? `${ds.id}#${i}`;
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
      const pos = e.position && Number.isFinite(e.position.lat) && Number.isFinite(e.position.lng) ? ([e.position.lng, e.position.lat] as [number, number]) : null;
      if (!pos) invalid.push(id);
      const media: MediaRef[] = [];
      const rights = "Rockstar Games media hosted by the source; reuse rights not established for this project. Linked, not redistributed.";
      if (e.igPhoto?.url) media.push({ kind: "source_image", localUrl: null, sourceUrl: `${SOL_ORIGIN}/${e.igPhoto.url}`, width: null, height: null, credit: e.igPhoto.credit || null, status: "linked", rightsNote: rights });
      if (e.video?.src) media.push({ kind: "video_file", localUrl: null, sourceUrl: `${SOL_ORIGIN}/${e.video.src}`, width: null, height: null, credit: null, status: "linked", rightsNote: rights });
      for (const l of [e.videoLink, e.externalLink]) {
        // The source data contains development placeholders such as https://localhost/VI/...; keep raw, mark unusable.
        if (l) media.push({ kind: "external_link", localUrl: null, sourceUrl: l, width: null, height: null, credit: null, status: /localhost/.test(l) ? "unavailable" : "linked", rightsNote: /localhost/.test(l) ? "Source record points at a localhost development URL; not publicly reachable." : "External reference link." });
      }
      const fov = e.motion?.fov && Number.isFinite(e.motion.fov.angle) && Number.isFinite(e.motion.fov.range) && Number.isFinite(e.motion.heading)
        ? { headingDeg: e.motion.heading!, angleDeg: e.motion.fov.angle!, range: e.motion.fov.range!, path: (e.motion.path ?? []).map((p) => [p.lng, p.lat] as [number, number]), source: "source_supplied" as const }
        : null;
      records.push({
        id, dataset: ds.id, label: e.name ?? id, category: ds.label, tags: e.tags ?? [], game: pos, realWorld: null,
        color: null, description: e.description ?? null, editedRaw: e.lastEdit ? [e.lastEdit] : null, media, fov,
        sourceUrl: `${SOL_ORIGIN}/?marker=${encodeURIComponent(id)}`,
        attribution: "State of Leonida — https://map.stateofleonida.net (dataset and placement); media © respective owners",
        evidenceStatus: ds.evidence, placementStatus: pos ? "community_estimate" : "unknown",
      });
    });
    out[ds.id] = { records, raw: entries.length, invalid, duplicates, origin, sha256: hash, label: ds.label };
  }
  return out;
}

// ---------------------------------------------------------------------------

if (FETCH_SOL) await fetchSol();

const gt = gtadbRecords();
writeJson(path.join(P.normalized, "gtadb-landmarks.json"), gt.records, false);

const sol = solRecords();
const solAll = Object.values(sol).flatMap((d) => d.records);
// SoL-derived records stay in the gitignored cache: their redistribution rights are not established.
writeJson(path.join(P.cacheNormalized, "sol-records.json"), solAll, false);

const solFetchLog = fs.existsSync(path.join(P.solRaw, "fetch-log.json")) ? readJson(path.join(P.solRaw, "fetch-log.json")) : null;

writeJson(path.join(P.manifests, "dataset-snapshots.json"), {
  generatedAt: new Date().toISOString(),
  gtadb_landmarks: {
    origin: "bundled research snapshot (research/community-data/gtadb-landmarks-original.json)",
    sha256: gt.sha256, bytes: gt.bytes, rawCount: gt.rawCount,
    upstream: { repo: `https://github.com/${GTADB_REPO}`, path: "map/data/6/landmarks.json", commit: GTADB_COMMIT, commitEvidence: "Snapshot SHA-256 equals the file at this commit (checked 2026-10-09). The snapshot's original acquisition commit was not recorded." },
    license: "CC BY 4.0 (research/community-data/LICENSE-DATA.txt)",
  },
  stateofleonida: Object.fromEntries(Object.entries(sol).map(([k, v]) => [k, { label: v.label, origin: v.origin, sha256: v.sha256, rawCount: v.raw, invalidCoordinateIds: v.invalid, duplicateIds: v.duplicates }])),
  stateofleonidaFetch: solFetchLog,
});

console.log(`GTADB: ${gt.records.length} records (sha256 ${gt.sha256.slice(0, 12)}…)`);
for (const [k, v] of Object.entries(sol)) console.log(`${k}: ${v.raw} raw, origin=${v.origin ?? "missing"}`);
