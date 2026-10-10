/**
 * Reconciles imported datasets against the State of Leonida snapshot observed on 2026-10-09 and
 * writes: data/source-manifests/coverage-report.json, docs/COVERAGE_REPORT.md, apps/web/public/generated/atlas.json
 */
import fs from "node:fs";
import path from "node:path";
import { P, readJson, writeJson } from "./lib/paths.ts";
import { GTADB_OVERVIEW, gameToOverview, isInsideCrop } from "../packages/shared/src/coordinates.ts";
import type { SourceRecord } from "../packages/shared/src/schemas.ts";

/** Observed in the State of Leonida UI on 2026-10-09 (browser inspection recorded in the build brief). Snapshot values, not targets. */
const OBSERVED_2026_10_09 = {
  databaseOverviewTotal: 3282,
  renderedMarkerTotal: 3222,
  databaseCounts: { landmarks: 3100, screenshots: 47, leaks: 42, trailer1: 30, trailer2: 26, trailer3: 37 },
  renderedLandmarkLayer: 3040,
  mediaScreenshotsTab: 166,
  communityHub: "Coming soon",
};

const gt = readJson<SourceRecord[]>(path.join(P.normalized, "gtadb-landmarks.json"));
const solFile = path.join(P.cacheNormalized, "sol-records.json");
const sol = fs.existsSync(solFile) ? readJson<SourceRecord[]>(solFile) : [];
const snapshots = readJson<any>(path.join(P.manifests, "dataset-snapshots.json"));
const mapManifest = fs.existsSync(path.join(P.manifests, "map-revisions.json")) ? readJson<any>(path.join(P.manifests, "map-revisions.json")) : null;
const parity = readJson<any>(path.join(P.manifests, "feature-parity.json"));

function datasetStats(records: SourceRecord[]) {
  const ids = records.map((r) => r.id);
  const unique = new Set(ids);
  const withGame = records.filter((r) => r.game);
  const withRw = records.filter((r) => r.realWorld?.latLon);
  const neither = records.filter((r) => !r.game && !r.realWorld?.latLon);
  const inCrop = withGame.filter((r) => isInsideCrop(...gameToOverview(r.game![0], r.game![1])));
  const media = records.reduce((n, r) => n + r.media.length, 0);
  return {
    raw: records.length, uniqueIds: unique.size, duplicateIds: ids.length - unique.size,
    validGameCoordinates: withGame.length, realWorldCoordinates: withRw.length,
    noCoordinatesAtAll: neither.length, noCoordinatesIds: neither.map((r) => r.id),
    renderableOnGameMap: withGame.length, insideDisplayCrop: inCrop.length, outsideDisplayCropIds: withGame.filter((r) => !inCrop.includes(r)).map((r) => r.id),
    mediaAssociations: media, fovObservations: records.filter((r) => r.fov).length,
  };
}

const byDataset = new Map<string, SourceRecord[]>();
for (const r of [...gt, ...sol]) byDataset.set(r.dataset, [...(byDataset.get(r.dataset) ?? []), r]);
const stats = Object.fromEntries([...byDataset].map(([k, v]) => [k, datasetStats(v)]));

// Source client rule (parseMarker): a landmark with neither in-game nor real-life coordinates is dropped.
const gtStats = stats.gtadb_landmarks;
const sourceVisibleLandmarks = gtStats.raw - gtStats.noCoordinatesAtAll;
const sixSol = ["sol_screenshots", "sol_leaks", "sol_trailer1", "sol_trailer2", "sol_trailer3"].map((k) => stats[k]?.raw ?? 0);
const solNonLandmark = sixSol.reduce((a, b) => a + b, 0);

// el_screenshots: same IDs as screenshots? same positions?
const elRecords = byDataset.get("sol_el_screenshots") ?? [];
const shotById = new Map((byDataset.get("sol_screenshots") ?? []).map((r) => [r.id, r]));
const elComparison = elRecords.map((r) => {
  const m = shotById.get(r.id);
  return { id: r.id, alsoInScreenshots: !!m, samePosition: !!m && JSON.stringify(m.game) === JSON.stringify(r.game), sameLabel: !!m && m.label === r.label };
});

const reconciliation = {
  observedSnapshot: OBSERVED_2026_10_09,
  imported: {
    landmarks: gtStats.raw,
    nonLandmarkSourceRecords: solNonLandmark,
    nonLandmarkBreakdown: Object.fromEntries(["sol_screenshots", "sol_leaks", "sol_trailer1", "sol_trailer2", "sol_trailer3"].map((k) => [k, stats[k]?.raw ?? 0])),
    total: gtStats.raw + solNonLandmark,
  },
  explanation: {
    databaseOverview: `${gtStats.raw} landmarks + ${solNonLandmark} non-landmark records = ${gtStats.raw + solNonLandmark} (observed ${OBSERVED_2026_10_09.databaseOverviewTotal}).`,
    renderedLayer: `Source parseMarker() returns null for landmarks with neither game nor real-world coordinates. In this snapshot that is ${gtStats.noCoordinatesAtAll} records → ${sourceVisibleLandmarks} landmark markers (observed ${OBSERVED_2026_10_09.renderedLandmarkLayer}); + ${solNonLandmark} = ${sourceVisibleLandmarks + solNonLandmark} (observed ${OBSERVED_2026_10_09.renderedMarkerTotal}).`,
    missingSixtyIds: gtStats.noCoordinatesIds,
    confidence: "Reproduced from source client code + our snapshot. The source's own GTADB sync revision is shown only in an admin endpoint, so equality of snapshots is inferred from matching counts, not verified.",
    ourHandling: `The ${gtStats.noCoordinatesAtAll} records are kept, searchable in the data view, and flagged 'no coordinates'. ${gtStats.raw - gtStats.validGameCoordinates - gtStats.noCoordinatesAtAll} further records have real-world but no game coordinates; they appear in lists and the real-world view, not on the game map.`,
  },
  matches: {
    databaseOverview: gtStats.raw + solNonLandmark === OBSERVED_2026_10_09.databaseOverviewTotal,
    renderedTotal: sourceVisibleLandmarks + solNonLandmark === OBSERVED_2026_10_09.renderedMarkerTotal,
    renderedLandmarks: sourceVisibleLandmarks === OBSERVED_2026_10_09.renderedLandmarkLayer,
  },
  elScreenshots: {
    file: "data/el_screenshots.json",
    count: elRecords.length,
    note: "Not one of the six overview datasets. All IDs also occur in screenshots.json; treated as an alternate (Extended Look) view of those records, not as new records.",
    comparison: elComparison,
  },
  media: {
    sourceScreenshotsTabEntries: { observed: OBSERVED_2026_10_09.mediaScreenshotsTab, status: "pending_permission", reason: "Listing comes from get-media-files.php, which robots.txt disallows; not requested. Distinct from the 47 screenshot markers." },
    artworksTab: { status: "pending_permission", total: null, reason: "Same disallowed endpoint; total not discovered." },
    trailersTab: { status: "pending_permission", total: null, reason: "Same disallowed endpoint; total not discovered." },
    markerMediaAssociations: Object.fromEntries([...byDataset].map(([k]) => [k, stats[k].mediaAssociations])),
    officialArchives: readJson<any>(path.join(P.research, "official-download-links.json")).downloads.map((d: any) => ({ ...d, status: "linked", note: "Official archive URL; not downloaded. Rockstar retains rights." })),
  },
};

const assets = [
  { id: "gtadb_landmarks", kind: "dataset", status: "imported", reason: "CC BY 4.0; bundled snapshot byte-identical to pinned commit.", rights: "CC BY 4.0" },
  { id: "gtadb_photos", kind: "media", status: "linked", reason: "Fetched on demand from the pinned GitHub commit and cached; underlying game imagery © Rockstar, real-world photo provenance per file not stated.", rights: "GTADB CC BY 4.0 repository file; third-party rights retained" },
  { id: "gtadb_tiles_yanis16", kind: "basemap", status: "imported", reason: "z1–z4 cached from GitHub (scripts/prepare-map.ts); z5–z6 on demand within a daily budget.", rights: "CC BY 4.0 (GTA VI Map Tiles)" },
  ...["sol_screenshots", "sol_leaks", "sol_trailer1", "sol_trailer2", "sol_trailer3", "sol_el_screenshots"].map((id) => ({
    id, kind: "dataset", status: stats[id] ? "imported" : "pending_retrieval",
    reason: stats[id] ? "Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed." : "Run pnpm data:fetch-sol or place an owner export in data/owner-exports/.",
    rights: "pending_permission (redistribution)",
  })),
  { id: "sol_media_files", kind: "media", status: "linked", reason: "Rockstar screenshots/trailer frames hosted by the source; referenced by URL, never copied.", rights: "Rockstar Games; not licensed to this project" },
  { id: "sol_yanis_v16_tiles", kind: "basemap", status: "linked", reason: "30 zoom-2 tiles cached locally for registration comparison only.", rights: "pending_permission" },
  { id: "sol_rickrick_tiles", kind: "basemap", status: "pending_permission", reason: "Revision metadata recorded; tiles not retrieved.", rights: "pending_permission" },
  { id: "sol_historical_overlays", kind: "comparison", status: "pending_permission", reason: "GTA V/IV/VC/SA/RDR2 map images are third-party game maps; bounds recorded, local asset slots provided.", rights: "Rockstar Games / map authors" },
  { id: "sol_credits", kind: "provenance", status: fs.existsSync(path.join(P.solRaw, "credits.json")) ? "imported" : "pending_retrieval", reason: "Shown as attribution in the Sources drawer.", rights: "attribution" },
  { id: "sol_database_changelog", kind: "provenance", status: fs.existsSync(path.join(P.solRaw, "database_changelog.json")) ? "imported" : "pending_retrieval", reason: "Recent-change history exposed publicly.", rights: "reference" },
  { id: "sol_media_listing", kind: "media", status: "pending_permission", reason: "get-media-files.php disallowed by robots.txt.", rights: "n/a" },
  { id: "sol_leaderboard_users", kind: "accounts", status: "unavailable", reason: "Other site's users/scores are not imported by design.", rights: "n/a" },
  { id: "sol_community_hub", kind: "feature", status: "unavailable", reason: "Labelled 'Coming soon' at inspection; hidden functionality not invented.", rights: "n/a" },
];

const report = {
  generatedAt: new Date().toISOString(),
  primarySource: "https://map.stateofleonida.net/?marker=L588",
  datasets: stats,
  reconciliation,
  assets,
  featureParity: parity,
  mapRevisions: mapManifest ? { activePrimary: mapManifest.primaryReference.activeRevision, rendered: mapManifest.renderedBasemap.id, registration: mapManifest.registrationAgainstPrimary } : null,
  snapshots,
};
writeJson(path.join(P.manifests, "coverage-report.json"), report);

// ---------------------------------------------------------------------------
// Web bundle: compact list + full details split, so the map loads fast.
// ---------------------------------------------------------------------------
const seen = new Set<string>();
const merged: SourceRecord[] = [];
for (const r of [...gt, ...sol]) {
  if (r.dataset === "sol_el_screenshots" && shotById.has(r.id)) continue; // alias of screenshots record
  if (seen.has(r.id)) continue;
  seen.add(r.id);
  merged.push(r);
}
const datasets = [...new Set(merged.map((r) => r.dataset))];
const compact = merged.map((r) => [
  r.id, datasets.indexOf(r.dataset), r.label, r.category, r.tags, r.game ? Math.round(r.game[0] * 100) / 100 : null, r.game ? Math.round(r.game[1] * 100) / 100 : null,
  r.realWorld?.latLon ? 1 : 0, r.media.some((m) => m.kind === "game_photo" || m.kind === "source_image") ? 1 : 0,
  r.fov ? [r.fov.headingDeg, r.fov.angleDeg, r.fov.range] : 0, r.color,
]);
fs.mkdirSync(P.webGenerated, { recursive: true });
writeJson(path.join(P.webGenerated, "atlas.json"), { generatedAt: report.generatedAt, datasets, records: compact }, false);
writeJson(path.join(P.cacheNormalized, "atlas-full.json"), merged, false);
writeJson(path.join(P.webGenerated, "coverage.json"), report, false);

// Markdown summary
const md = `# Source coverage report

Generated ${report.generatedAt} by \`pnpm coverage\`. Machine-readable: \`data/source-manifests/coverage-report.json\`.

Primary reference: <https://map.stateofleonida.net/?marker=L588>

## Count reconciliation (snapshot observed 2026-10-09)

| | Imported here | Observed at source | Match |
|---|---:|---:|:--:|
| Database overview total | ${reconciliation.imported.total} | ${OBSERVED_2026_10_09.databaseOverviewTotal} | ${reconciliation.matches.databaseOverview ? "yes" : "NO"} |
| Rendered markers | ${sourceVisibleLandmarks + solNonLandmark} | ${OBSERVED_2026_10_09.renderedMarkerTotal} | ${reconciliation.matches.renderedTotal ? "yes" : "NO"} |
| Rendered landmark layer | ${sourceVisibleLandmarks} | ${OBSERVED_2026_10_09.renderedLandmarkLayer} | ${reconciliation.matches.renderedLandmarks ? "yes" : "NO"} |

${reconciliation.explanation.databaseOverview}

${reconciliation.explanation.renderedLayer}

**The missing 60:** ${reconciliation.explanation.missingSixtyIds.join(", ")}

${reconciliation.explanation.confidence} ${reconciliation.explanation.ourHandling}

## Datasets

| Dataset | Raw | Unique IDs | Game XY | Real-world | No coords | Inside display crop | Media refs | FOV |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${Object.entries(stats).map(([k, s]: any) => `| ${k} | ${s.raw} | ${s.uniqueIds} | ${s.validGameCoordinates} | ${s.realWorldCoordinates} | ${s.noCoordinatesAtAll} | ${s.insideDisplayCrop} | ${s.mediaAssociations} | ${s.fovObservations} |`).join("\n")}

\`el_screenshots.json\` (${elRecords.length}): ${reconciliation.elScreenshots.note}

## Media

- Source "Screenshots" tab showed ${OBSERVED_2026_10_09.mediaScreenshotsTab} entries — **pending permission** (listing endpoint disallowed by robots.txt). This is distinct from the 47 screenshot markers.
- Artwork and trailer tab totals: not discovered (same endpoint).
- Official Rockstar archives: linked, not downloaded (${reconciliation.media.officialArchives.map((a: any) => `${a.label} ${a.listed_count}`).join(", ")}).

## Asset status

| Asset | Kind | Status | Reason |
|---|---|---|---|
${assets.map((a) => `| ${a.id} | ${a.kind} | ${a.status} | ${a.reason} |`).join("\n")}

## Feature parity

| Area | Status | Notes |
|---|---|---|
${parity.areas.map((a: any) => `| ${a.area} | ${a.status} | ${a.notes} |`).join("\n")}

Additional source capabilities discovered during implementation: ${parity.discovered.map((d: any) => `${d.name} (${d.status})`).join("; ")}.
`;
fs.writeFileSync(path.join(P.docs, "COVERAGE_REPORT.md"), md);
console.log("coverage:", reconciliation.matches, `bundle ${merged.length} records`);
