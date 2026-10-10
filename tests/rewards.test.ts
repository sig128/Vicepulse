import { afterEach, describe, expect, it } from "vitest";
import { makeApp, guest, reachOffer, tickUntil, type TestApp } from "./helpers.ts";
import { MockSettlement } from "../apps/server/src/rewards/settlement.ts";

let t: TestApp;
afterEach(async () => { await t?.close(); });

const done = (w: any) => ["resolved", "declined"].includes(w.mission?.stage);

/** Jules on the south bridge: no leak roll, no checkpoint → a clean, real-time delivery. */
async function deliver(app: TestApp, g: Awaited<ReturnType<typeof guest>>) {
  await reachOffer(app, g);
  await g.mission({ action: "choose_driver", actorId: "jules" });
  await g.mission({ action: "choose_route", route: "south_bridge" });
  await g.mission({ action: "accept" });
  return tickUntil(app, g.me.sessionWorldId, done);
}

describe("app-points ledger", () => {
  it("a delivery issues exactly one 250-point entry, traceable to the resolving event", async () => {
    t = await makeApp();
    const g = await guest(t);
    const w = await deliver(t, g);
    expect(w.mission.outcome).toBe("delivered");
    const r = (await g.get("/api/rewards")).body;
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e).toMatchObject({ campaign_id: "night-shift-s1", amount: 250, unit: "VP_POINTS", status: "earned", idempotency_key: `night-shift-s1:${g.sid}` });
    expect(e.meta).toEqual({ demoAssisted: false, transferable: false });
    expect(e.why).toMatchObject({ type: "mission.resolved", worldId: g.me.sessionWorldId });
    expect(e.why.payload.outcome).toBe("delivered");
    expect(r.totals.earned).toBe(250);
    expect(r.market).toBeNull();
  });

  it("restarting and delivering again in the same session never pays twice", async () => {
    t = await makeApp();
    const g = await guest(t);
    await deliver(t, g);
    const restart = await g.post("/api/demo/restart", {});
    expect(restart.status).toBe(200);
    expect(restart.body.sessionWorldId).not.toBe(g.me.sessionWorldId);
    const g2 = { ...g, me: { ...g.me, sessionWorldId: restart.body.sessionWorldId } };
    const w = await deliver(t, g2);
    expect(w.mission.outcome).toBe("delivered");
    const r = (await g.get("/api/rewards")).body;
    expect(r.entries).toHaveLength(1);
    expect(r.totals.earned).toBe(250);
  });

  it("issue() enforces idempotency, per-user limits, disabled campaigns and the allocation", () => {
    return (async () => {
      t = await makeApp();
      const g = await guest(t);
      const L = t.ctx.ledger, db = t.ctx.db;
      const claim = (key: string, amount: number, campaignId = "finder-s1") => db.tx(() => L.issue({ campaignId, amount, unit: "VP_POINTS", reason: "test", eventId: "e", idempotencyKey: key, demoAssisted: false }, g.sid));
      expect(claim("k1", 30)).toMatchObject({ created: true });
      expect(claim("k1", 30)).toMatchObject({ created: false, reason: "duplicate" });
      expect(claim("k2", 30)).toMatchObject({ created: false, reason: "per_user_limit" }); // finder-s1 limit 50
      expect(claim("k3", 20)).toMatchObject({ created: true });
      expect(claim("x1", 25, "external-gtavi-s0")).toMatchObject({ created: false, reason: "campaign_disabled" });
      expect(claim("x2", 25, "no-such-campaign")).toMatchObject({ created: false, reason: "unknown_campaign" });
      db.run("UPDATE reward_campaigns SET allocation_total = 60 WHERE id = 'atlas-contrib-s1'");
      expect(claim("a1", 50, "atlas-contrib-s1")).toMatchObject({ created: true });
      expect(claim("a2", 20, "atlas-contrib-s1")).toMatchObject({ created: false, reason: "allocation_exhausted" });
      db.run("UPDATE reward_campaigns SET starts_at = '2099-01-01T00:00:00Z' WHERE id = 'atlas-contrib-s1'");
      expect(claim("a3", 5, "atlas-contrib-s1")).toMatchObject({ created: false, reason: "outside_window" });
    })();
  });

  it("the ledger is append-only at the database level", async () => {
    t = await makeApp();
    const g = await guest(t);
    await deliver(t, g);
    expect(() => t.ctx.db.run("DELETE FROM reward_entries")).toThrow();
    expect(() => t.ctx.db.run("UPDATE reward_entries SET amount = 99999")).toThrow();
  });
});

describe("settlement", () => {
  it("is disabled by default and every claim is refused", async () => {
    t = await makeApp();
    const g = await guest(t);
    await deliver(t, g);
    const r = (await g.get("/api/rewards")).body;
    expect(r.settlement).toMatchObject({ adapter: "disabled", enabled: false });
    const c = await g.post(`/api/rewards/${r.entries[0].id}/claim`);
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("settlement_disabled");
  });

  it("with the mock adapter: one settlement per entry, owner only, never for demo-assisted runs", async () => {
    t = await makeApp({}, new MockSettlement());
    const g = await guest(t), other = await guest(t);
    await deliver(t, g);
    const entry = (await g.get("/api/rewards")).body.entries[0];
    expect((await other.post(`/api/rewards/${entry.id}/claim`)).body.code).toBe("not_found");
    const first = await g.post(`/api/rewards/${entry.id}/claim`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, state: "confirmed" });
    const again = await g.post(`/api/rewards/${entry.id}/claim`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_settled");
    // Concurrent double-claims resolve to exactly one settlement row.
    expect(t.ctx.db.all("SELECT * FROM settlements WHERE entry_id = ?", entry.id)).toHaveLength(1);

    const d = await guest(t);
    await reachOffer(t, d);
    await d.mission({ action: "choose_driver", actorId: "jules" });
    await d.mission({ action: "choose_route", route: "south_bridge" });
    await d.mission({ action: "accept" });
    let w = t.ctx.sim.get(d.me.sessionWorldId)!;
    for (let i = 0; i < 20 && !done(w); i++) { await d.post("/api/demo/advance", { simSeconds: 600 }); w = t.ctx.sim.get(d.me.sessionWorldId)!; }
    expect(w.mission!.outcome).toBe("delivered");
    const de = (await d.get("/api/rewards")).body.entries[0];
    expect(de.meta.demoAssisted).toBe(true);
    const c = await d.post(`/api/rewards/${de.id}/claim`);
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("demo_assisted");
  });

  it("concurrent claims for the same entry produce exactly one settlement", async () => {
    t = await makeApp({}, new MockSettlement());
    const g = await guest(t);
    await deliver(t, g);
    const entry = (await g.get("/api/rewards")).body.entries[0];
    const results = await Promise.all([1, 2, 3, 4].map(() => g.post(`/api/rewards/${entry.id}/claim`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(t.ctx.db.all("SELECT * FROM settlements WHERE entry_id = ?", entry.id)).toHaveLength(1);
  });
});

describe("evidence review workflow", () => {
  const ADMIN = { "x-admin-token": "test-admin-token-0123456789abcdef", "content-type": "application/json" };

  it("submitted → under_review → approved → reward_eligible issues one contribution entry; illegal jumps are refused", async () => {
    t = await makeApp();
    const g = await guest(t);
    const s = await g.post("/api/evidence", { kind: "mapping_correction", recordId: "L588", note: "The pin sits one block west of the entrance in trailer 2.", url: null, proposedGame: [-740, 1490] });
    expect(s.status).toBe(200);
    const review = (state: string, headers: Record<string, string> = ADMIN) => t.app.inject({ method: "POST", url: `/api/admin/evidence/${s.body.id}/review`, headers, payload: JSON.stringify({ state }) });
    expect((await review("approved")).statusCode).toBe(409);
    expect((await review("under_review", { "content-type": "application/json" })).statusCode).toBe(401);
    expect((await review("under_review", { ...ADMIN, "x-admin-token": "test-admin-token-0123456789abcdeX" })).statusCode).toBe(401);
    expect((await review("under_review")).statusCode).toBe(200);
    expect((await review("approved")).statusCode).toBe(200);
    const final = await review("reward_eligible");
    expect(final.statusCode).toBe(200);
    expect(final.json().reward).toMatchObject({ created: true });
    expect((await review("reward_eligible")).statusCode).toBe(409);
    const r = (await g.get("/api/rewards")).body;
    expect(r.entries.map((e: any) => [e.campaign_id, e.amount])).toEqual([["atlas-contrib-s1", 25]]);
  });

  it("admin review does not exist without a configured token", async () => {
    t = await makeApp({ adminToken: "" });
    const r = await t.app.inject({ method: "POST", url: "/api/admin/evidence/x/review", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(r.statusCode).toBe(404);
  });

  it("external gameplay evidence is recorded but its campaign pays nothing", async () => {
    t = await makeApp();
    const g = await guest(t);
    const s = await g.post("/api/evidence", { kind: "external_gameplay", recordId: null, note: "I finished a heist in GTA VI, here is the clip link.", url: "https://www.youtube.com/watch?v=abc", proposedGame: null });
    expect(s.status).toBe(200);
    expect(s.body.note).toMatch(/disabled/);
    for (const state of ["under_review", "approved", "reward_eligible"]) {
      const r = await t.app.inject({ method: "POST", url: `/api/admin/evidence/${s.body.id}/review`, headers: ADMIN, payload: JSON.stringify({ state }) });
      if (state === "reward_eligible") expect(r.json().reward).toMatchObject({ created: false, reason: "campaign_disabled" });
    }
    expect((await g.get("/api/rewards")).body.entries).toEqual([]);
  });
});
