import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MissionCommand, AgentCommand } from "@vicepulse/shared";
import { CommandError } from "../simulation/engine.ts";
import { canSee } from "../simulation/store.ts";
import { SHARED_WORLD_ID, loadScenario } from "../simulation/runner.ts";
import { CAST } from "../simulation/cast.ts";
import type { Ctx } from "../app.ts";

export function worldRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sim, store } = ctx;
  const scenario = loadScenario();

  app.get("/api/scenario", async () => ({
    id: scenario.id, title: scenario.title, note: scenario.note,
    places: scenario.places, nodes: scenario.routeGraph.nodes, edges: scenario.routeGraph.edges,
    cast: CAST.map((c) => ({ id: c.id, name: c.name, role: c.role, bio: c.bio })),
  }));

  app.get("/api/me", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const world = await sim.ensureSession(sid);
    sim.touch(world.id);
    const s = ctx.sessions.info(sid);
    return { displayName: s.display_name, since: s.created_at, sessionWorldId: world.id, sharedWorldId: SHARED_WORLD_ID, demoControls: ctx.cfg.demoControls };
  });

  app.post<{ Body: { name: string } }>("/api/me/name", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const p = z.object({ name: z.string().trim().regex(/^[\p{L}\p{N} _.-]{2,20}$/u) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_name", message: "2–20 letters, numbers, spaces, _ . -" });
    ctx.sessions.rename(sid, p.data.name);
    return { displayName: p.data.name };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/worlds/:id/snapshot", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const id = req.params.id === "mine" ? (await sim.ensureSession(sid)).id : req.params.id;
    if (!sim.canView(id, sid)) return reply.code(403).send({ error: "forbidden", message: "This world belongs to another session." });
    const state = sim.get(id) ?? (id === SHARED_WORLD_ID ? await sim.ensureShared() : null);
    if (!state) return reply.code(404).send({ error: "not_found" });
    sim.touch(id);
    const limit = Math.min(400, Math.max(1, Number(req.query.limit ?? 200)));
    const events = store.recent(id, limit * 2).filter((e) => canSee(e, sid)).slice(-limit);
    return { view: sim.engine.view(state, sid), events };
  });

  app.get<{ Params: { id: string; eventId: string } }>("/api/worlds/:id/events/:eventId/chain", async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    if (!sim.canView(req.params.id, sid)) return reply.code(403).send({ error: "forbidden" });
    const state = sim.get(req.params.id);
    const chain: unknown[] = [];
    let cur = store.event(req.params.eventId);
    if (!cur || cur.worldId !== req.params.id) return reply.code(404).send({ error: "not_found" });
    for (let i = 0; cur && i < 12; i++) {
      const revealed = state?.revealedEventIds.includes(cur.id);
      if (canSee(cur, sid) || revealed) chain.push({ ...cur, revealed: !!revealed && !canSee(cur, sid) });
      else chain.push({ id: cur.id, type: "undisclosed", sequence: cur.sequence, simTime: cur.simTime, note: "Something happened here that you have not learned about yet." });
      cur = cur.causeEventId ? store.event(cur.causeEventId) : null;
    }
    return { chain };
  });

  const commandLimit = { config: { rateLimit: { max: 40, timeWindow: "10 seconds" } } };

  // Commands only ever target the caller's own session world; there is no world ID in the body.
  app.post("/api/worlds/mine/mission", commandLimit, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const parsed = MissionCommand.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_command", message: parsed.error.issues[0]?.message });
    const world = await sim.ensureSession(sid);
    try {
      const r = await sim.mutate(world.id, (s) => sim.engine.mission(s, parsed.data));
      return { ok: true, view: sim.engine.view(r.state, sid), events: r.changes.events.filter((e) => canSee(e, sid)), rewards: r.rewards };
    } catch (e) {
      if (e instanceof CommandError) return reply.code(409).send({ error: e.code, message: e.message });
      throw e;
    }
  });

  app.post("/api/worlds/mine/agent", commandLimit, async (req, reply) => {
    const sid = ctx.sessions.ensure(req, reply);
    const parsed = AgentCommand.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_command", message: parsed.error.issues[0]?.message });
    const world = await sim.ensureSession(sid);
    try {
      const r = await sim.mutate(world.id, (s) => sim.engine.agent(s, parsed.data));
      return { ok: true, view: sim.engine.view(r.state, sid), events: r.changes.events.filter((e) => canSee(e, sid)), rewards: r.rewards };
    } catch (e) {
      if (e instanceof CommandError) return reply.code(409).send({ error: e.code, message: e.message });
      throw e;
    }
  });

  // Demo controls: development/demo only. Advancing time marks the run demo-assisted.
  app.post<{ Body: { seed?: string } }>("/api/demo/restart", async (req, reply) => {
    if (!ctx.cfg.demoControls) return reply.code(404).send({ error: "disabled" });
    const sid = ctx.sessions.ensure(req, reply);
    const seed = z.string().regex(/^[\w:-]{1,40}$/).optional().safeParse(req.body?.seed);
    const w = await sim.restartSession(sid, seed.success ? seed.data : undefined);
    return { sessionWorldId: w.id };
  });

  app.post<{ Body: { simSeconds?: number } }>("/api/demo/advance", async (req, reply) => {
    if (!ctx.cfg.demoControls) return reply.code(404).send({ error: "disabled" });
    const sid = ctx.sessions.ensure(req, reply);
    const secs = Math.min(1800, Math.max(6, Number(req.body?.simSeconds ?? 120)));
    const w = await sim.ensureSession(sid);
    const r = await sim.mutate(w.id, (s) => sim.engine.advance_time(s, secs));
    return { ok: true, view: sim.engine.view(r.state, sid), rewards: r.rewards };
  });
}
