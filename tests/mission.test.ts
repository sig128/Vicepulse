import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, guest, reachOffer, tickUntil, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeAll(async () => { t = await makeApp(); });
afterAll(async () => { await t.close(); });

const done = (w: any) => w.mission?.stage === "resolved" || w.mission?.stage === "declined";

describe("The Night Shift — transitions and outcomes", () => {
  it("opens with one legal action and refuses everything else with 409", async () => {
    const g = await guest(t);
    const snap = await g.get("/api/worlds/mine/snapshot");
    expect(snap.status).toBe(200);
    expect(snap.body.view.mission.stage).toBe("lead");
    expect(snap.body.view.mission.actions.map((a: any) => a.key)).toEqual(["investigate"]);
    for (const cmd of [{ action: "accept" }, { action: "choose_driver", actorId: "jules" }, { action: "respond", option: "wait" }]) {
      const r = await g.mission(cmd);
      expect(r.status, JSON.stringify(cmd)).toBe(409);
    }
    // Schema-invalid input never reaches the engine.
    expect((await g.mission({ action: "teleport" })).status).toBe(400);
    expect((await g.mission({ action: "choose_route", route: "helicopter" })).status).toBe(400);
  });

  it("Jules on the causeway hits the checkpoint; Mara's call gets the coupe through on time", async () => {
    const g = await guest(t);
    await reachOffer(t, g);
    await tickUntil(t, g.me.sessionWorldId, (x) => x.checkpoint.active);
    expect((await g.mission({ action: "choose_driver", actorId: "jules" })).status).toBe(200);
    const acc = await g.mission({ action: "accept" });
    expect(acc.status).toBe(200);
    expect(acc.body.view.resources.cash).toBe(1200 - 650);

    const w = await tickUntil(t, g.me.sessionWorldId, (x) => x.mission.stage === "complication" || done(x));
    expect(w.mission.stage).toBe("complication");
    expect(w.mission.complication.type).toBe("checkpoint");
    // Jules never leaks the route: no roll is ever made for her.
    expect(w.mission.leak.rolled).toBe(false);

    const r = await g.mission({ action: "respond", option: "call_contact" });
    expect(r.status).toBe(200);
    expect(r.body.view.resources.favors).toBe(0);
    const end = await tickUntil(t, g.me.sessionWorldId, done);
    expect(end.mission.outcome).toBe("delivered");
    expect(end.mission.nextLeadId).toBe("dorian_regular");
    expect(end.mission.demoAssisted).toBe(false);
    expect(end.resources.cash).toBe(1200 - 650 + 900);
  });

  it("settling Nico's debt removes the leak; reroute around the checkpoint still delivers, and Nico owes you", async () => {
    const g = await guest(t);
    await reachOffer(t, g);
    // The debt is unknown until Wren asks Bo; the option does not exist before that.
    let v = (await g.get("/api/worlds/mine/snapshot")).body.view;
    expect(v.mission.actions.some((a: any) => a.key === "settle_debt:nico")).toBe(false);
    expect((await g.mission({ action: "settle_debt", actorId: "nico" })).status).toBe(409);
    expect((await g.mission({ action: "ask_about", actorId: "nico" })).status).toBe(200);
    v = (await g.get("/api/worlds/mine/snapshot")).body.view;
    expect(v.facts.some((f: any) => f.key === "nico_debt")).toBe(true);
    expect((await g.mission({ action: "settle_debt", actorId: "nico" })).status).toBe(200);
    expect((await g.mission({ action: "settle_debt", actorId: "nico" })).status).toBe(409);
    await g.mission({ action: "choose_driver", actorId: "nico" });
    await tickUntil(t, g.me.sessionWorldId, (x) => x.checkpoint.active);
    expect((await g.mission({ action: "accept" })).status).toBe(200);

    const raw = t.ctx.sim.get(g.me.sessionWorldId)!;
    expect(raw.mission!.leak.leaked).toBe(false);
    const w = await tickUntil(t, g.me.sessionWorldId, (x) => x.mission.stage === "complication" || done(x));
    expect(w.mission.complication?.type).toBe("checkpoint");
    expect((await g.mission({ action: "respond", option: "reroute" })).status).toBe(200);
    const end = await tickUntil(t, g.me.sessionWorldId, done);
    expect(["delivered", "delivered_late"]).toContain(end.mission.outcome);
    expect(end.mission.nextLeadId).toBe("nico_owes_you");
    expect(end.resources.cash).toBe(1200 - 400 - 200 + (end.mission.outcome === "delivered" ? 900 : 600));
  });

  it("declining ends the run with no reward and a cold lead", async () => {
    const g = await guest(t);
    await reachOffer(t, g);
    const r = await g.mission({ action: "decline" });
    expect(r.status).toBe(200);
    expect(r.body.view.mission.stage).toBe("declined");
    expect(r.body.view.mission.nextLeadId).toBe("mara_cold");
    expect(r.body.rewards).toEqual([]);
    expect((await g.get("/api/rewards")).body.entries).toEqual([]);
    expect((await g.mission({ action: "accept" })).status).toBe(409);
  });

  it("demo time advance marks the run demo-assisted, and that sticks through resolution", async () => {
    const g = await guest(t);
    await g.mission({ action: "investigate", leadId: "coupe_velvet" });
    const a = await g.post("/api/demo/advance", { simSeconds: 600 });
    expect(a.status).toBe(200);
    expect(a.body.view.mission.demoAssisted).toBe(true);
  });

  it("demo controls do not exist when disabled", async () => {
    const t2 = await makeApp({ demoControls: false });
    try {
      const g = await guest(t2);
      expect((await g.post("/api/demo/advance", { simSeconds: 600 })).status).toBe(404);
      expect((await g.post("/api/demo/restart", {})).status).toBe(404);
    } finally { await t2.close(); }
  });
});

describe("determinism", () => {
  const run = async (seed: string) => {
    const e = t.ctx.sim.engine;
    const { state, events } = await e.create("det-world", "session", "det-session", seed, new Date(0));
    const log: string[] = events.map((x) => `${x.sequence}:${x.type}:${x.simTime}`);
    const step = async (fn: () => Promise<any>) => { const c = await fn(); log.push(...c.events.map((x: any) => `${x.sequence}:${x.type}:${x.simTime}:${JSON.stringify(x.payload)}`)); };
    await step(() => e.mission(state, { action: "investigate", leadId: "coupe_velvet" }, new Date(0)));
    for (let i = 0; i < 400 && state.mission!.stage !== "offer"; i++) await step(() => e.tick(state, 6, new Date(0)));
    await step(() => e.mission(state, { action: "choose_driver", actorId: "nico" }, new Date(0)));
    await step(() => e.mission(state, { action: "choose_route", route: "south_bridge" }, new Date(0)));
    await step(() => e.mission(state, { action: "accept" }, new Date(0)));
    for (let i = 0; i < 300; i++) await step(() => e.tick(state, 6, new Date(0)));
    return { log, leak: { ...state.mission!.leak, eventId: undefined }, actors: Object.values(state.actors).map((a) => [a.id, a.nodeId, a.pos.map((p) => p.toFixed(3))]) };
  };

  it("same world id + seed + commands → identical event log and positions", async () => {
    const a = await run("fixed-seed-1"), b = await run("fixed-seed-1");
    expect(a.log.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
  });

  it("a different seed changes the random rolls", async () => {
    const seeds = ["s-a", "s-b", "s-c", "s-d", "s-e", "s-f"];
    const rolls = new Set<number | null>();
    for (const s of seeds) rolls.add((await run(s)).leak.roll);
    expect(rolls.size).toBeGreaterThan(1);
  });
});
