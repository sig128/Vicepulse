import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const P = {
  research: path.join(ROOT, "research"),
  reference: path.join(ROOT, "reference"),
  manifests: path.join(ROOT, "data/source-manifests"),
  normalized: path.join(ROOT, "data/normalized"),
  cache: path.join(ROOT, "data/cache"),
  solRaw: path.join(ROOT, "data/cache/stateofleonida/raw"),
  cacheNormalized: path.join(ROOT, "data/cache/normalized"),
  ownerExports: path.join(ROOT, "data/owner-exports"),
  tiles: path.join(ROOT, "data/cache/tiles"),
  photos: path.join(ROOT, "data/cache/photos"),
  webGenerated: path.join(ROOT, "apps/web/public/generated"),
  docs: path.join(ROOT, "docs"),
};

export const GTADB_REPO = "rolux/gtadb.org";
/** Commit at which `map/data/6/landmarks.json` is byte-identical to the bundled snapshot (verified 2026-10-09). */
export const GTADB_COMMIT = "76d44848850222ab5051bc8f561316989b5c3570";
export const SOL_ORIGIN = "https://map.stateofleonida.net";
export const UA = "VICEPULSE-source-adapter/0.1 (+low-rate, cached; contact: project owner)";

export function sha256(buf: Buffer | string) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function readJson<T = unknown>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function writeJson(p: string, data: unknown, pretty = true) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
