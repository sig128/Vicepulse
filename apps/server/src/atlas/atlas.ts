import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.ts";
import { gtadbTileInRange, gtadbTileGameRect, GTADB_LEGEND_CLIP, type SourceRecord } from "@vicepulse/shared";

const GTADB_COMMIT = "76d44848850222ab5051bc8f561316989b5c3570";
const RAW = `https://raw.githubusercontent.com/rolux/gtadb.org/${GTADB_COMMIT}`;

export class Atlas {
  readonly records = new Map<string, SourceRecord>();
  readonly source: "full" | "gtadb_only";

  constructor() {
    const full = path.join(ROOT, "data/cache/normalized/atlas-full.json");
    const gt = path.join(ROOT, "data/normalized/gtadb-landmarks.json");
    const file = fs.existsSync(full) ? full : gt;
    this.source = file === full ? "full" : "gtadb_only";
    for (const r of JSON.parse(fs.readFileSync(file, "utf8")) as SourceRecord[]) this.records.set(r.id, r);
  }

  get(id: string) { return this.records.get(id) ?? null; }

  /** Records with a cached-able GTADB game photo and on-map coordinates; used by Marker Finder. */
  finderPool() {
    return [...this.records.values()].filter((r) => r.dataset === "gtadb_landmarks" && r.game && r.media.some((m) => m.kind === "game_photo"));
  }
}

/** Fetches from fixed GitHub URLs only (never user-supplied URLs), with a daily request budget. */
export class UpstreamCache {
  private day = "";
  private spent = 0;
  constructor(private enabled: boolean, private budget: number) {}

  private allow() {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.spent = 0; }
    if (!this.enabled || this.spent >= this.budget) return false;
    this.spent++;
    return true;
  }

  status() { return { onDemand: this.enabled, budget: this.budget, spentToday: this.spent }; }

  async tile(z: number, x: number, y: number): Promise<string | null> {
    if (!gtadbTileInRange(z, x, y)) return null;
    const r = gtadbTileGameRect(z, x, y);
    if (r.minX >= GTADB_LEGEND_CLIP.minX && r.minY >= GTADB_LEGEND_CLIP.minY) return null;
    const file = path.join(ROOT, "data/cache/tiles/yanis,16", String(z), `${z},${y},${x}.jpg`);
    if (fs.existsSync(file)) return file;
    if (!this.allow()) return null;
    return this.fetchTo(`${RAW}/maps/tiles/6/${encodeURIComponent("yanis,16")}/${z}/${z},${y},${x}.jpg`, file);
  }

  async photo(id: string, kind: "ig" | "rl"): Promise<string | null> {
    if (!/^L\d{1,5}$/.test(id)) return null;
    const file = path.join(ROOT, "data/cache/photos", `${id},${kind}.jpg`);
    if (fs.existsSync(file)) return file;
    if (!this.allow()) return null;
    return this.fetchTo(`${RAW}/map/photos/6/${id},${kind}.jpg`, file);
  }

  private async fetchTo(url: string, file: string) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // must be JPEG
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return file;
    } catch {
      return null;
    }
  }
}
