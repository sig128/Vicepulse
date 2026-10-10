import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import type { RewardSettlementAdapter } from "../apps/server/src/rewards/settlement.ts";

export const ORIGIN = "http://localhost:5173";

/** A fresh server on a throwaway SQLite file. The tick timer is off; tests advance time explicitly. */
export async function makeApp(config: Partial<Config> = {}, settlementAdapter?: RewardSettlementAdapter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-test-"));
  const { app, ctx } = await buildApp({
    config: { databasePath: path.join(dir, "test.db"), demoControls: true, adminToken: "test-admin-token-0123456789abcdef", tileFetchOnDemand: false, ...config },
    settlementAdapter,
    startSimulation: false,
  });
  await app.ready();
  return {
    app, ctx, dir,
    async close() { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

/** A guest session: the cookie is the only identity the server accepts. */
export async function guest(t: TestApp) {
  const r = await t.app.inject({ method: "GET", url: "/api/me" });
  const c = r.cookies.find((x) => x.name === "vp_sid");
  if (!c) throw new Error("no session cookie");
  const cookie = `vp_sid=${c.value}`;
  const me = r.json() as { sessionWorldId: string; sharedWorldId: string; displayName: string };
  const sid = t.ctx.sessions.fromCookieHeader(cookie)!;
  const call = async (method: "GET" | "POST" | "PUT", url: string, body?: unknown) => {
    const res = await t.app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null };
  };
  return {
    cookie, me, sid,
    get: (url: string) => call("GET", url),
    post: (url: string, body: unknown = {}) => call("POST", url, body),
    put: (url: string, body: unknown) => call("PUT", url, body),
    mission: (cmd: unknown) => call("POST", "/api/worlds/mine/mission", cmd),
    agent: (cmd: unknown) => call("POST", "/api/worlds/mine/agent", cmd),
  };
}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }

/** Real (non-demo) time passing, exactly like the server's tick loop: 1 s wall = 6 s city. */
export async function tickFor(t: TestApp, worldId: string, simSeconds: number, step = 6) {
  for (let s = 0; s < simSeconds; s += step) await t.ctx.sim.mutate(worldId, (w) => t.ctx.sim.engine.tick(w, step));
  return t.ctx.sim.get(worldId)!;
}

/** Tick until a predicate holds on the world (bounded). */
export async function tickUntil(t: TestApp, worldId: string, pred: (w: any) => boolean, maxSimSeconds = 3600, step = 6) {
  for (let s = 0; s < maxSimSeconds; s += step) {
    const w = t.ctx.sim.get(worldId)!;
    if (pred(w)) return w;
    await t.ctx.sim.mutate(worldId, (x) => t.ctx.sim.engine.tick(x, step));
  }
  throw new Error(`condition not reached within ${maxSimSeconds} sim seconds`);
}

/** Runs the opening of The Night Shift to the point where the offer is on the table. */
export async function reachOffer(t: TestApp, g: Awaited<ReturnType<typeof guest>>) {
  const r = await g.mission({ action: "investigate", leadId: "coupe_velvet" });
  if (r.status !== 200) throw new Error(`investigate failed: ${JSON.stringify(r.body)}`);
  return tickUntil(t, g.me.sessionWorldId, (w) => w.mission?.stage === "offer");
}
