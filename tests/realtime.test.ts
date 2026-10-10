import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, guest, ORIGIN, type TestApp } from "./helpers.ts";

let t: TestApp;
let base: string;
beforeAll(async () => {
  t = await makeApp();
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = t.app.server.address() as { port: number };
  base = `ws://127.0.0.1:${addr.port}/ws`;
});
afterAll(async () => { await t.close(); });

type Msg = { type: string; [k: string]: any };

function connect(cookie: string | null, origin = ORIGIN) {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  const ws = new WebSocket(base, { headers } as any);
  const inbox: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  let closed: { code: number } | null = null;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  ws.addEventListener("close", (e) => { closed = { code: e.code }; });
  const open = new Promise<void>((res, rej) => { ws.addEventListener("open", () => res()); ws.addEventListener("error", () => rej(new Error("ws error"))); });
  return {
    ws, inbox, open,
    get closed() { return closed; },
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: (pred: (m: Msg) => boolean, ms = 4000) => new Promise<Msg>((res, rej) => {
      const hit = inbox.find(pred);
      if (hit) return res(hit);
      const timer = setTimeout(() => rej(new Error("timeout waiting for message")), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(timer); res(m); } });
    }),
    closedWith: () => new Promise<number>((res) => { if (closed) res(closed.code); else ws.addEventListener("close", (e) => res(e.code)); }),
  };
}

describe("realtime stream", () => {
  it("refuses connections without a valid session or from foreign origins", async () => {
    const anon = connect(null);
    expect(await anon.closedWith()).toBe(4401);
    const g = await guest(t);
    const evil = connect(g.cookie, "https://evil.example");
    expect(await evil.closedWith()).toBe(4403);
  });

  it("subscribe → snapshot; live events carry throughSeq; ping/pong", async () => {
    const g = await guest(t);
    const c = connect(g.cookie);
    await c.open;
    c.send({ type: "subscribe", worldId: g.me.sessionWorldId, lastSeq: t.ctx.sim.get(g.me.sessionWorldId)!.seq });
    const snap = await c.next((m) => m.type === "snapshot");
    expect(snap.view.owner).toBe(true);
    await g.mission({ action: "investigate", leadId: "coupe_velvet" });
    const ev = await c.next((m) => m.type === "events" && !m.replay);
    expect(ev.events.some((e: any) => e.type === "agent.dispatched")).toBe(true);
    expect(ev.throughSeq).toBe(t.ctx.sim.get(g.me.sessionWorldId)!.seq);
    c.send({ type: "ping" });
    expect((await c.next((m) => m.type === "pong")).t).toBeGreaterThan(0);
    c.ws.close();
  });

  it("reconnect with lastSeq replays exactly the missed events, in order, without duplicates", async () => {
    const g = await guest(t);
    const world = g.me.sessionWorldId;
    const c1 = connect(g.cookie);
    await c1.open;
    c1.send({ type: "subscribe", worldId: world, lastSeq: 0 });
    await c1.next((m) => m.type === "snapshot");
    const cursor = t.ctx.sim.get(world)!.seq;
    c1.ws.close();
    await c1.closedWith();

    // Things happen while disconnected.
    await g.mission({ action: "investigate", leadId: "coupe_velvet" });
    for (let i = 0; i < 30; i++) await t.ctx.sim.mutate(world, (w) => t.ctx.sim.engine.tick(w, 6));
    const after = t.ctx.sim.get(world)!.seq;
    expect(after).toBeGreaterThan(cursor);

    const c2 = connect(g.cookie);
    await c2.open;
    c2.send({ type: "subscribe", worldId: world, lastSeq: cursor });
    const replay = await c2.next((m) => m.type === "events" && m.replay);
    expect(replay.throughSeq).toBe(after);
    const seqs = replay.events.map((e: any) => e.sequence);
    expect(seqs.every((s: number) => s > cursor && s <= after)).toBe(true);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    const expected = t.ctx.store.eventsAfter(world, cursor, 1000).filter((e) => e.visibility !== "hidden").map((e) => e.sequence);
    expect(seqs).toEqual(expected);
    c2.ws.close();
  });

  it("subscribing to someone else's world is refused", async () => {
    const a = await guest(t), b = await guest(t);
    const c = connect(b.cookie);
    await c.open;
    c.send({ type: "subscribe", worldId: a.me.sessionWorldId, lastSeq: 0 });
    const err = await c.next((m) => m.type === "error");
    expect(err.message).toMatch(/not authorised/);
    await new Promise((r) => setTimeout(r, 100));
    expect(c.inbox.some((m) => m.type === "snapshot" || m.type === "events")).toBe(false);
    c.ws.close();
  });

  it("garbage input does not crash the connection", async () => {
    const g = await guest(t);
    const c = connect(g.cookie);
    await c.open;
    c.ws.send("{not json");
    expect((await c.next((m) => m.type === "error")).message).toBe("invalid json");
    c.send({ type: "ping" });
    await c.next((m) => m.type === "pong");
    c.ws.close();
  });
});
