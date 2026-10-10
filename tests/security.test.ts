import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, guest, reachOffer, tickUntil, ORIGIN, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeAll(async () => { t = await makeApp(); });
afterAll(async () => { await t.close(); });

const HIDDEN_TYPES = ["driver.leaked_route", "rival.dispatched"];

describe("session isolation", () => {
  it("each guest gets a private world; nobody else can read it, its chains, or command it", async () => {
    const a = await guest(t), b = await guest(t);
    expect(a.sid).not.toBe(b.sid);
    expect(a.me.sessionWorldId).not.toBe(b.me.sessionWorldId);
    expect(a.me.sharedWorldId).toBe(b.me.sharedWorldId);

    await a.mission({ action: "investigate", leadId: "coupe_velvet" });
    const aEvents = (await a.get("/api/worlds/mine/snapshot")).body.events;
    expect((await b.get(`/api/worlds/${a.me.sessionWorldId}/snapshot`)).status).toBe(403);
    expect((await b.get(`/api/worlds/${a.me.sessionWorldId}/events/${aEvents.at(-1).id}/chain`)).status).toBe(403);
    // Commands carry no world id: B's commands can only ever touch B's own world.
    const bInvestigate = await b.mission({ action: "investigate", leadId: "coupe_velvet" });
    expect(bInvestigate.body.view.id).toBe(b.me.sessionWorldId);
    expect(t.ctx.sim.get(a.me.sessionWorldId)!.seq).toBe((await a.get("/api/worlds/mine/snapshot")).body.view.seq);
  });

  it("the shared world is readable by everyone but exposes no owner-only fields", async () => {
    const b = await guest(t);
    const s = await b.get(`/api/worlds/${b.me.sharedWorldId}/snapshot`);
    expect(s.status).toBe(200);
    expect(s.body.view.owner).toBe(false);
    expect(s.body.view.mission).toBeNull();
    expect(s.body.view.resources).toBeNull();
    expect(s.body.view.facts).toEqual([]);
    for (const e of s.body.events) expect(e.visibility).toBe("public");
  });

  it("a forged or tampered cookie is ignored and yields a fresh, unrelated session", async () => {
    const a = await guest(t);
    const [id, sig] = a.cookie.slice("vp_sid=".length).split(".");
    const forged = [`vp_sid=${id}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, `vp_sid=${id}`, `vp_sid=${id}.`, "vp_sid=../../etc/passwd"];
    for (const cookie of forged) {
      expect(t.ctx.sessions.fromCookieHeader(cookie)).toBeNull();
      const r = await t.app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
      expect(r.json().sessionWorldId).not.toBe(a.me.sessionWorldId);
      expect(r.cookies.find((c) => c.name === "vp_sid")).toBeTruthy();
    }
  });

  it("the session cookie is HttpOnly and SameSite", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/me" });
    const c = r.cookies.find((x) => x.name === "vp_sid")!;
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe("lax");
  });

  it("client-supplied player ids in bodies or queries are never used for identity", async () => {
    const a = await guest(t), b = await guest(t);
    const r = await t.app.inject({ method: "POST", url: `/api/worlds/mine/mission?sessionId=${a.sid}`, headers: { cookie: b.cookie, origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ action: "investigate", leadId: "coupe_velvet", sessionId: a.sid, worldId: a.me.sessionWorldId }) });
    expect(r.json().view.id).toBe(b.me.sessionWorldId);
    expect(t.ctx.sim.get(a.me.sessionWorldId)!.mission!.stage).toBe("lead");
  });
});

describe("cross-site protection", () => {
  it("state-changing requests from foreign origins are rejected", async () => {
    const a = await guest(t);
    for (const [method, url] of [["POST", "/api/worlds/mine/mission"], ["PUT", "/api/annotations"], ["POST", "/api/rewards/x/claim"], ["POST", "/api/evidence"]] as const) {
      const r = await t.app.inject({ method, url, headers: { cookie: a.cookie, origin: "https://evil.example", "content-type": "application/json" }, payload: "{}" });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe("hidden information", () => {
  it("Nico's leak is never in snapshots; the chain shows it as undisclosed until the outcome reveals it", async () => {
    const g = await guest(t);
    let world = g.me.sessionWorldId;
    for (let i = 0; i < 40; i++) {
      const gg = { ...g, me: { ...g.me, sessionWorldId: world } };
      await reachOffer(t, gg);
      await g.mission({ action: "choose_driver", actorId: "nico" });
      await g.mission({ action: "choose_route", route: "south_bridge" });
      await g.mission({ action: "accept" });
      if (t.ctx.sim.get(world)!.mission!.leak.leaked) break;
      world = (await g.post("/api/demo/restart", { seed: `leak-hunt-${i}` })).body.sessionWorldId;
    }
    const raw = t.ctx.sim.get(world)!;
    expect(raw.mission!.leak.leaked).toBe(true);
    const leakId = raw.mission!.leak.eventId!;

    const snap = (await g.get("/api/worlds/mine/snapshot")).body;
    expect(snap.events.some((e: any) => HIDDEN_TYPES.includes(e.type) || e.id === leakId)).toBe(false);
    expect(JSON.stringify(snap.view)).not.toMatch(/leaked_route|roll|threshold/);
    expect(snap.view.mission.leakRevealed).toBe(false);

    const w = await tickUntil(t, world, (x) => x.mission.stage === "complication" || x.mission.stage === "resolved");
    if (w.mission.stage === "complication") {
      const comp = (await g.get("/api/worlds/mine/snapshot")).body.events.findLast((e: any) => e.type === "mission.complication");
      const chain = (await g.get(`/api/worlds/${world}/events/${comp.id}/chain`)).body.chain;
      expect(chain[1]).toMatchObject({ id: leakId, type: "undisclosed" });
      expect(chain[1].payload).toBeUndefined();
      expect((await g.mission({ action: "respond", option: "negotiate" })).status).toBe(200);
    }
    const end = await tickUntil(t, world, (x) => x.mission.stage === "resolved");
    expect(end.mission.nextLeadId).toBe("who_paid_nico");
    const resolved = (await g.get("/api/worlds/mine/snapshot")).body.events.findLast((e: any) => e.type === "fact.revealed");
    const chain = (await g.get(`/api/worlds/${world}/events/${resolved.id}/chain`)).body.chain;
    expect(chain[1]).toMatchObject({ id: leakId, type: "driver.leaked_route", revealed: true });

    // Another guest never sees any of it, revealed or not.
    const other = await guest(t);
    expect((await other.get(`/api/worlds/${world}/events/${resolved.id}/chain`)).status).toBe(403);
  });

  it("realtime replay applies the same filter", async () => {
    const g = await guest(t);
    await reachOffer(t, g);
    const all = t.ctx.store.eventsAfter(g.me.sessionWorldId, 0, 1000);
    const { canSee } = await import("../apps/server/src/simulation/store.ts");
    const other = await guest(t);
    expect(all.filter((e) => canSee(e, other.sid))).toEqual(all.filter((e) => e.visibility === "public"));
    expect(all.filter((e) => canSee(e, g.sid)).every((e) => e.visibility === "public" || e.visibility === `participant:${g.sid}`)).toBe(true);
  });
});

describe("evidence intake", () => {
  const base = { kind: "evidence_link", recordId: "L588", note: "Source for this pin", proposedGame: null };

  it("accepts only vetted hosts and never fetches", async () => {
    const g = await guest(t);
    for (const url of ["http://169.254.169.254/latest/meta-data", "http://localhost:8787/api/health", "https://gtadb.org.evil.example/x", "https://evil.example/?u=https://gtadb.org", "file:///etc/passwd"]) {
      const r = await g.post("/api/evidence", { ...base, url });
      expect(r.status, url).toBe(400);
    }
    expect((await g.post("/api/evidence", { ...base, url: "https://map.stateofleonida.net/?marker=L588" })).status).toBe(200);
  });

  it("rejects unknown records and files that are not really images, and is rate limited", async () => {
    const t2 = await makeApp();
    try {
      const g = await guest(t2);
      expect((await g.post("/api/evidence", { ...base, url: null, recordId: "L99999999" })).body.error).toBe("unknown_record");
      const fakePng = Buffer.from("<svg onload=alert(1)>").toString("base64");
      expect((await g.post("/api/evidence", { ...base, url: null, imageBase64: fakePng })).status).toBe(415);
      for (let i = 0; i < 4; i++) await g.post("/api/evidence", { ...base, url: null });
      const limited = await g.post("/api/evidence", { ...base, url: null });
      expect(limited.status).toBe(429);
      expect(limited.body.error).toBe("rate_limited");
    } finally { await t2.close(); }
  });
});

describe("annotations", () => {
  it("are per session and validated", async () => {
    const a = await guest(t), b = await guest(t);
    const shape = { tool: "rect", points: [[0, 0], [100, 100]], color: "#49EAF5", width: 3, opacity: 0.8 };
    const put = await a.put("/api/annotations", { shapes: [shape] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await a.get("/api/annotations")).body.shapes).toHaveLength(1);
    expect((await b.get("/api/annotations")).body.shapes).toEqual([]);
    expect((await a.put("/api/annotations", { shapes: [{ ...shape, tool: "<script>" }] })).status).toBe(400);
  });
});
