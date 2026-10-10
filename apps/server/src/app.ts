import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { ROOT, loadConfig, type Config } from "./config.ts";
import { Db } from "./db/database.ts";
import { Sessions } from "./auth/session.ts";
import { Ledger } from "./rewards/ledger.ts";
import { SettlementService, createSettlement, type RewardSettlementAdapter } from "./rewards/settlement.ts";
import { WorldStore } from "./simulation/store.ts";
import { Simulation } from "./simulation/runner.ts";
import { Hub } from "./realtime/hub.ts";
import { Atlas, UpstreamCache } from "./atlas/atlas.ts";
import { createNarrative, type NarrativeProvider } from "./providers/narrative.ts";
import { atlasRoutes } from "./api/atlas-routes.ts";
import { worldRoutes } from "./api/world-routes.ts";
import { playRoutes } from "./api/play-routes.ts";

export interface Ctx {
  cfg: Config; db: Db; sessions: Sessions; ledger: Ledger; settlement: SettlementService; store: WorldStore;
  sim: Simulation; hub: Hub; atlas: Atlas; upstream: UpstreamCache; narrative: NarrativeProvider;
}

export async function buildApp(opts: { config?: Partial<Config>; settlementAdapter?: RewardSettlementAdapter; startSimulation?: boolean; logger?: boolean } = {}) {
  const cfg = loadConfig(opts.config);
  const db = new Db(cfg.databasePath);
  db.migrate();
  const ledger = new Ledger(db);
  ledger.ensureCampaigns();
  const narrative = createNarrative(cfg, db);
  const store = new WorldStore(db, ledger);
  const sim = new Simulation(cfg, store, narrative);
  const hub = new Hub(sim, store);
  sim.publisher = hub;
  const ctx: Ctx = {
    cfg, db, sessions: new Sessions(db, cfg.sessionSecret, cfg.production), ledger,
    settlement: new SettlementService(db, opts.settlementAdapter ?? createSettlement(cfg.settlementAdapter, cfg.production)),
    store, sim, hub, atlas: new Atlas(), upstream: new UpstreamCache(cfg.tileFetchOnDemand, cfg.tileFetchDailyBudget), narrative,
  };

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024, trustProxy: cfg.trustProxy });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 600, timeWindow: "1 minute",
    errorResponseBuilder: (_req, c) => ({ statusCode: 429, error: "rate_limited", message: `Slow down a little — try again in ${c.after}.` }),
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  // Reject cross-site state changes. Browsers always send Origin on POST/PUT.
  app.addHook("onRequest", async (req, reply) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !cfg.allowedOrigins.includes(origin)) return reply.code(403).send({ error: "bad_origin" });
    }
    reply.header("x-content-type-options", "nosniff").header("referrer-policy", "strict-origin-when-cross-origin");
  });

  app.get("/api/health", async () => ({
    ok: true, simulation: sim.running ? "running" : "stopped", narrative: narrative.name, settlement: ctx.settlement.adapter.id,
    atlas: { source: ctx.atlas.source, records: ctx.atlas.records.size }, connections: hub.connections, time: new Date().toISOString(),
  }));

  app.get("/ws", { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin && !cfg.allowedOrigins.includes(origin)) { socket.close(4403, "bad origin"); return; }
    const sid = ctx.sessions.fromCookieHeader(req.headers.cookie);
    if (!sid) { socket.close(4401, "no session"); return; }
    hub.attach(socket, sid);
  });

  atlasRoutes(app, ctx);
  worldRoutes(app, ctx);
  playRoutes(app, ctx);

  const dist = path.join(ROOT, "apps/web/dist");
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/tiles") || req.url.startsWith("/media")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((err: any, _req, reply) => {
    if (err.statusCode === 429) return reply.code(429).send({ error: "rate_limited", message: "Slow down a little." });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: "bad_request", message: err.message });
    console.error(err);
    return reply.code(500).send({ error: "server_error", message: "Something broke on our side. Your progress is saved." });
  });

  await sim.ensureShared();
  if (opts.startSimulation !== false) sim.start();
  app.addHook("onClose", async () => { sim.stop(); hub.close(); db.close(); });
  return { app, ctx };
}
