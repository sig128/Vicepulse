import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { FinderGuess, SaveAnnotations, EvidenceSubmission, VETTED_EVIDENCE_HOSTS, gameDistance } from "@vicepulse/shared";
import { ROOT } from "../config.ts";
import type { Ctx } from "../app.ts";

const ROUNDS = 5;
export const finderScore = (distance: number) => Math.round(5000 * Math.exp(-distance / 1500));

export function playRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  // ---------------------------------------------------------------- annotations
  app.get("/api/annotations", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const row = db.get<{ shapes_json: string; updated_at: string }>("SELECT shapes_json, updated_at FROM annotations WHERE session_id = ?", sid);
    return { shapes: row ? JSON.parse(row.shapes_json) : [], updatedAt: row?.updated_at ?? null };
  });
  app.put("/api/annotations", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, bodyLimit: 512 * 1024 }, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const p = SaveAnnotations.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_annotations", message: p.error.issues[0]?.message });
    const t = new Date().toISOString();
    db.run("INSERT INTO annotations (session_id, shapes_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET shapes_json = excluded.shapes_json, updated_at = excluded.updated_at", sid, JSON.stringify(p.data.shapes), t);
    return { ok: true, updatedAt: t };
  });

  // ---------------------------------------------------------------- marker finder
  app.post("/api/finder/games", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const pool = ctx.atlas.finderPool();
    const picked = new Set<string>();
    while (picked.size < ROUNDS) picked.add(pool[crypto.randomInt(pool.length)].id);
    const id = crypto.randomUUID();
    const rounds = [...picked].map((recordId) => ({ roundId: crypto.randomBytes(12).toString("base64url"), recordId, guess: null as null | [number, number], distance: null as number | null, score: null as number | null }));
    db.run("INSERT INTO finder_games (id, session_id, created_at, state_json) VALUES (?, ?, ?, ?)", id, sid, new Date().toISOString(), JSON.stringify({ rounds }));
    // Answers stay on the server; the client only receives opaque round IDs.
    return { gameId: id, rounds: rounds.map((r) => ({ roundId: r.roundId, image: `/api/finder/rounds/${r.roundId}/image` })) };
  });

  const findRound = (sid: string, roundId: string) => {
    const games = db.all<{ id: string; state_json: string; finished_at: string | null }>("SELECT id, state_json, finished_at FROM finder_games WHERE session_id = ? ORDER BY created_at DESC LIMIT 20", sid);
    for (const g of games) {
      const st = JSON.parse(g.state_json);
      const r = st.rounds.find((x: any) => x.roundId === roundId);
      if (r) return { game: g, state: st, round: r };
    }
    return null;
  };

  app.get<{ Params: { roundId: string } }>("/api/finder/rounds/:roundId/image", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const f = findRound(sid, req.params.roundId);
    if (!f) return reply.code(404).send();
    const file = await ctx.upstream.photo(f.round.recordId, "ig");
    if (!file) return reply.code(503).send({ error: "unavailable", message: "Photo not cached and could not be fetched." });
    return reply.header("content-type", "image/jpeg").header("cache-control", "private, no-store").send(fs.createReadStream(file));
  });

  app.post("/api/finder/guess", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const p = FinderGuess.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_guess" });
    const result = db.tx(() => {
      const f = findRound(sid, p.data.roundId);
      if (!f) return { code: 404 as const, body: { error: "not_found" } };
      if (f.round.guess) return { code: 409 as const, body: { error: "already_guessed", message: "This round already has a guess." } };
      const rec = ctx.atlas.get(f.round.recordId)!;
      const d = gameDistance([p.data.x, p.data.y], rec.game!);
      f.round.guess = [p.data.x, p.data.y]; f.round.distance = d; f.round.score = finderScore(d);
      const done = f.state.rounds.every((r: any) => r.guess);
      const total = f.state.rounds.reduce((n: number, r: any) => n + (r.score ?? 0), 0);
      db.run("UPDATE finder_games SET state_json = ?, total_score = ?, finished_at = ? WHERE id = ?", JSON.stringify(f.state), total, done ? new Date().toISOString() : null, f.game.id);
      let reward = null;
      if (done) {
        const amount = Math.floor(total / 1000);
        if (amount > 0) reward = ctx.ledger.issue({ campaignId: "finder-s1", amount, unit: "VP_POINTS", reason: `Marker Finder game (${total} score)`, eventId: f.game.id, idempotencyKey: `finder-s1:${f.game.id}`, demoAssisted: false }, sid);
      }
      return { code: 200 as const, body: { distance: d, score: f.round.score, answer: { id: rec.id, label: rec.label, game: rec.game }, finished: done, total, reward } };
    });
    return reply.code(result.code).send(result.body);
  });

  app.get("/api/finder/leaderboard", async () => {
    const rows = db.all<any>(
      "SELECT g.total_score AS score, g.finished_at, s.display_name AS name FROM finder_games g JOIN sessions s ON s.id = g.session_id WHERE g.finished_at IS NOT NULL ORDER BY g.total_score DESC, g.finished_at ASC LIMIT 10",
    );
    return { leaderboard: rows, note: "VICEPULSE players only. No scores are imported from other sites." };
  });

  // ---------------------------------------------------------------- rewards
  app.get("/api/rewards", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const sum = ctx.ledger.summary(sid);
    const entries = sum.entries.map((e: any) => {
      const ev = e.event_id ? ctx.store.event(e.event_id) : null;
      return { ...e, why: ev ? { eventId: ev.id, worldId: ev.worldId, type: ev.type, payload: ev.payload, sequence: ev.sequence } : null };
    });
    return { ...sum, entries, settlement: { adapter: ctx.settlement.adapter.id, enabled: ctx.settlement.adapter.enabled, description: ctx.settlement.adapter.description }, market: null, note: "App points are not money, not a token and not transferable. No asset, chain or price is configured." };
  });

  app.post<{ Params: { id: string } }>("/api/rewards/:id/claim", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const r = await ctx.settlement.claim(req.params.id, sid);
    return r.ok ? r : reply.code(409).send(r);
  });

  // ---------------------------------------------------------------- evidence review workflow
  app.post("/api/evidence", { config: { rateLimit: { max: 6, timeWindow: "1 hour" } }, bodyLimit: 2_200_000 }, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const body = req.body as any;
    const p = EvidenceSubmission.safeParse(body);
    if (!p.success) return reply.code(400).send({ error: "invalid_submission", message: p.error.issues[0]?.message });
    if (p.data.url) {
      const host = new URL(p.data.url).hostname;
      if (!VETTED_EVIDENCE_HOSTS.includes(host)) return reply.code(400).send({ error: "url_not_allowed", message: `Links must point to a vetted source (${VETTED_EVIDENCE_HOSTS.join(", ")}). We never fetch submitted URLs.` });
    }
    if (p.data.recordId && !ctx.atlas.get(p.data.recordId)) return reply.code(400).send({ error: "unknown_record" });
    let fileName: string | null = null;
    if (typeof body.imageBase64 === "string") {
      const buf = Buffer.from(body.imageBase64, "base64");
      const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isWebp = buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
      if (buf.length > 1_500_000) return reply.code(413).send({ error: "file_too_large", message: "Max 1.5 MB" });
      if (!isPng && !isJpg && !isWebp) return reply.code(415).send({ error: "unsupported_type", message: "PNG, JPEG or WebP only" });
      fileName = `${crypto.randomUUID()}.${isPng ? "png" : isJpg ? "jpg" : "webp"}`;
      const dir = path.join(ROOT, "apps/server/var/uploads");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileName), buf);
    }
    const id = crypto.randomUUID();
    db.run("INSERT INTO evidence_submissions (id, session_id, kind, record_id, note, url, proposed_x, proposed_y, file_name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)",
      id, sid, p.data.kind, p.data.recordId, p.data.note, p.data.url, p.data.proposedGame?.[0] ?? null, p.data.proposedGame?.[1] ?? null, fileName, new Date().toISOString());
    return { id, state: "submitted", note: p.data.kind === "external_gameplay" ? "External gameplay rewards are disabled: no authorised verification method exists. Your submission is recorded for review only." : "A reviewer will check this against the sources." };
  });

  app.get("/api/evidence", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    return { submissions: db.all("SELECT id, kind, record_id, note, url, proposed_x, proposed_y, state, created_at, reviewed_at, review_note FROM evidence_submissions WHERE session_id = ? ORDER BY created_at DESC", sid) };
  });

  // Admin review. Disabled unless ADMIN_TOKEN (≥ 24 chars) is configured.
  app.post<{ Params: { id: string }; Body: { state: string; note?: string } }>("/api/admin/evidence/:id/review", async (req, reply) => {
    if (!ctx.cfg.adminToken) return reply.code(404).send({ error: "disabled" });
    const token = String(req.headers["x-admin-token"] ?? "");
    if (token.length !== ctx.cfg.adminToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ctx.cfg.adminToken))) return reply.code(401).send({ error: "unauthorised" });
    const next = req.body?.state;
    const allowed: Record<string, string[]> = { submitted: ["under_review", "rejected"], under_review: ["approved", "rejected"], approved: ["reward_eligible"] };
    const result = db.tx(() => {
      const s = db.get<any>("SELECT * FROM evidence_submissions WHERE id = ?", req.params.id);
      if (!s) return { code: 404, body: { error: "not_found" } };
      if (!allowed[s.state]?.includes(next)) return { code: 409, body: { error: "invalid_transition", from: s.state, to: next } };
      db.run("UPDATE evidence_submissions SET state = ?, reviewed_at = ?, review_note = ? WHERE id = ?", next, new Date().toISOString(), String(req.body?.note ?? "").slice(0, 500), s.id);
      let reward = null;
      if (next === "reward_eligible") {
        const campaign = s.kind === "external_gameplay" ? "external-gtavi-s0" : "atlas-contrib-s1";
        reward = ctx.ledger.issue({ campaignId: campaign, amount: 25, unit: "VP_POINTS", reason: `Approved ${s.kind.replace("_", " ")}`, eventId: null as unknown as string, idempotencyKey: `${campaign}:${s.id}`, demoAssisted: false }, s.session_id);
      }
      return { code: 200, body: { id: s.id, state: next, reward } };
    });
    return reply.code(result.code).send(result.body);
  });
}
