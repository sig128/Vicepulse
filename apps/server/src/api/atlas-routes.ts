import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { ROOT } from "../config.ts";
import type { Ctx } from "../app.ts";

const readJsonIf = (p: string) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

export function atlasRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get<{ Params: { id: string } }>("/api/atlas/records/:id", async (req, reply) => {
    const r = ctx.atlas.get(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found", message: `No record ${req.params.id} in the imported datasets.` });
    return r;
  });

  app.get<{ Querystring: { dataset?: string; kind?: string; offset?: string; limit?: string } }>("/api/atlas/media", async (req) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0) | 0), limit = Math.min(120, Math.max(1, Number(req.query.limit ?? 60) | 0));
    const items: unknown[] = [];
    const counts: Record<string, number> = {};
    for (const r of ctx.atlas.records.values()) {
      if (req.query.dataset && r.dataset !== req.query.dataset) continue;
      for (const m of r.media) {
        if (req.query.kind && m.kind !== req.query.kind) continue;
        counts[m.status] = (counts[m.status] ?? 0) + 1;
        items.push({ recordId: r.id, label: r.label, dataset: r.dataset, ...m });
      }
    }
    return { total: items.length, counts, items: items.slice(offset, offset + limit) };
  });

  app.get<{ Params: { z: string; x: string; y: string } }>("/tiles/yanis16/:z/:x/:y.jpg", async (req, reply) => {
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 6) return reply.code(400).send();
    const f = await ctx.upstream.tile(z, x, y);
    if (!f) return reply.code(404).header("cache-control", "no-store").send();
    return reply.header("content-type", "image/jpeg").header("cache-control", "public, max-age=604800, immutable").send(fs.createReadStream(f));
  });

  // Local-only comparison tiles of the primary source (not redistributed; absent in a fresh clone).
  app.get<{ Params: { x: string; y: string } }>("/tiles/sol-v16/2/:x/:y.png", async (req, reply) => {
    const x = Number(req.params.x), y = Number(req.params.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return reply.code(400).send();
    const f = path.join(ROOT, "data/cache/stateofleonida/compare-tiles", `2_${x}_${y}.png`);
    if (!fs.existsSync(f)) return reply.code(404).send();
    return reply.header("content-type", "image/png").header("cache-control", "private, max-age=3600").send(fs.createReadStream(f));
  });

  app.get<{ Params: { id: string; kind: string } }>("/media/gtadb/:id/:kind", async (req, reply) => {
    const { id, kind } = req.params;
    if (kind !== "ig" && kind !== "rl") return reply.code(400).send();
    const rec = ctx.atlas.get(id);
    if (!rec || !rec.media.some((m) => m.kind === (kind === "ig" ? "game_photo" : "real_world_photo"))) return reply.code(404).send();
    const f = await ctx.upstream.photo(id, kind);
    if (!f) return reply.code(503).send({ error: "unavailable", message: "Photo not cached and on-demand fetch is unavailable or over budget." });
    return reply.header("content-type", "image/jpeg").header("cache-control", "public, max-age=86400").send(fs.createReadStream(f));
  });

  app.get("/api/sources", async () => {
    const sol = path.join(ROOT, "data/cache/stateofleonida/raw");
    const changelog = readJsonIf(path.join(sol, "database_changelog.json"));
    const credits = readJsonIf(path.join(sol, "credits.json"));
    const news = readJsonIf(path.join(sol, "news.json"));
    const backgrounds = readJsonIf(path.join(sol, "backgrounds.json"));
    const fetchLog = readJsonIf(path.join(sol, "fetch-log.json"));
    return {
      atlasSource: ctx.atlas.source,
      coverage: readJsonIf(path.join(ROOT, "data/source-manifests/coverage-report.json")),
      maps: readJsonIf(path.join(ROOT, "data/source-manifests/map-revisions.json")),
      registration: readJsonIf(path.join(ROOT, "docs/validation/registration-stats.json")),
      stateOfLeonida: {
        cached: fs.existsSync(sol),
        fetchLog,
        changelog: changelog?.entries?.map((e: any) => ({ databaseId: e.databaseId, type: e.type, title: e.title, date: e.date, id: e.id })) ?? null,
        credits: credits ? { title: credits.title, sections: credits.sections?.map((s: any) => ({ title: s.title, members: (s.members ?? []).map((m: any) => ({ name: m.name, role: m.role })) })) } : null,
        newsArticles: news?.articles?.length ?? null,
        backgrounds: backgrounds ? Object.values(backgrounds.backgrounds ?? {}).map((b: any) => ({ id: b.id, name: b.name?.en ?? b.id, author: b.author, status: "pending_permission" })) : null,
        communityHub: "Coming soon (observed 2026-10-09); not reproduced",
      },
      adaptations: [
        "GTADB landmark arrays converted to named fields; original bytes preserved in research/community-data.",
        "GTADB yanis,16 tiles cached from a pinned GitHub commit; display crop hides the artwork legend column.",
        "Afterdark mode recolours the same raster in a shader (dark land, glowing roads/coast). Geometry is unchanged.",
        "State of Leonida datasets normalised (lat→y, lng→x), cached locally, not redistributed.",
        "Marker categories mirror the source's rule; uncertainty punctuation in labels kept verbatim.",
        "Narrative places reuse source positions under fictional names; evidence records are never edited by the story.",
      ],
      upstream: ctx.upstream.status(),
    };
  });
}
