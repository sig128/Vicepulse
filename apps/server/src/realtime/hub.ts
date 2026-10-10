import type { WebSocket } from "ws";
import type { Simulation, Publisher } from "../simulation/runner.ts";
import { canSee, type WorldStore } from "../simulation/store.ts";
import type { StoredEvent } from "../simulation/engine.ts";

const REPLAY_LIMIT = 500;
const SOFT_BUFFER = 512 * 1024;
const HARD_BUFFER = 4 * 1024 * 1024;

interface Sub { ws: WebSocket; sessionId: string; worlds: Set<string>; alive: boolean }

/**
 * Event stream protocol (JSON):
 *  client → { type: "subscribe", worldId, lastSeq } | { type: "unsubscribe", worldId } | { type: "ping" }
 *  server → { type: "events", worldId, events, replay } | { type: "snapshot", worldId, view } | { type: "actors", worldId, ... }
 *           { type: "reset", worldId, reason } | { type: "error", message } | { type: "pong", t }
 * Replays are bounded; if a client is too far behind it receives "reset" and refetches the snapshot.
 */
export class Hub implements Publisher {
  private subs = new Set<Sub>();
  private heartbeat: NodeJS.Timeout;

  constructor(private sim: Simulation, private store: WorldStore) {
    this.heartbeat = setInterval(() => {
      for (const s of this.subs) {
        if (!s.alive) { s.ws.terminate(); this.subs.delete(s); continue; }
        s.alive = false;
        try { s.ws.ping(); } catch { /* closed */ }
      }
    }, 15_000);
  }

  close() { clearInterval(this.heartbeat); for (const s of this.subs) s.ws.close(1001, "server shutdown"); }

  attach(ws: WebSocket, sessionId: string) {
    const sub: Sub = { ws, sessionId, worlds: new Set(), alive: true };
    this.subs.add(sub);
    ws.on("pong", () => (sub.alive = true));
    ws.on("close", () => this.subs.delete(sub));
    ws.on("message", (raw) => {
      sub.alive = true;
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return this.send(sub, { type: "error", message: "invalid json" }); }
      if (msg?.type === "ping") return this.send(sub, { type: "pong", t: Date.now() });
      if (msg?.type === "unsubscribe" && typeof msg.worldId === "string") { sub.worlds.delete(msg.worldId); return; }
      if (msg?.type === "subscribe" && typeof msg.worldId === "string") {
        const worldId = msg.worldId;
        if (!this.sim.canView(worldId, sessionId)) return this.send(sub, { type: "error", worldId, message: "not authorised for this world" });
        sub.worlds.add(worldId);
        this.sim.touch(worldId);
        const lastSeq = Number.isInteger(msg.lastSeq) && msg.lastSeq >= 0 ? msg.lastSeq : 0;
        const missed = this.store.eventsAfter(worldId, lastSeq, REPLAY_LIMIT + 1);
        if (missed.length > REPLAY_LIMIT) {
          this.send(sub, { type: "reset", worldId, reason: "too far behind; refetch snapshot" });
        } else if (missed.length) {
          this.send(sub, { type: "events", worldId, replay: true, events: missed.filter((e) => canSee(e, sessionId)), throughSeq: missed.at(-1)!.sequence });
        }
        this.sendSnapshot(sub, worldId);
      }
    });
  }

  private send(sub: Sub, data: unknown, essential = true) {
    const ws = sub.ws;
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > HARD_BUFFER) { ws.close(1013, "client too slow"); return; }
    if (!essential && ws.bufferedAmount > SOFT_BUFFER) return;
    ws.send(JSON.stringify(data));
  }

  private sendSnapshot(sub: Sub, worldId: string) {
    const s = this.sim.get(worldId);
    if (s) this.send(sub, { type: "snapshot", worldId, view: this.sim.engine.view(s, sub.sessionId) });
  }

  publish(worldId: string, events: StoredEvent[]) {
    if (!events.length) return;
    const throughSeq = events.at(-1)!.sequence;
    for (const sub of this.subs) {
      if (!sub.worlds.has(worldId)) continue;
      // Every subscriber gets throughSeq so its resume cursor advances even past hidden events.
      this.send(sub, { type: "events", worldId, replay: false, events: events.filter((e) => canSee(e, sub.sessionId)), throughSeq });
    }
  }

  stateChanged(worldId: string, eventsProduced: boolean) {
    const s = this.sim.get(worldId);
    if (!s) return;
    for (const sub of this.subs) {
      if (!sub.worlds.has(worldId)) continue;
      if (eventsProduced) { this.sendSnapshot(sub, worldId); continue; }
      const v = this.sim.engine.view(s, sub.sessionId);
      this.send(sub, { type: "actors", worldId, simTime: v.simTime, clock: v.clock, seq: v.seq, actors: v.actors.map((a) => ({ id: a.id, pos: a.pos, nodeId: a.nodeId, route: a.route, moving: a.moving, speed: a.speed, task: a.task })), checkpoint: v.checkpoint, complication: v.mission?.complication ?? null }, false);
    }
  }

  get connections() { return this.subs.size; }
}
