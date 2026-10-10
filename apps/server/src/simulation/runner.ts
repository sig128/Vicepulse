import fs from "node:fs";
import path from "node:path";
import { ROOT, type Config } from "../config.ts";
import { Engine, type Changes, type StoredEvent, type WorldState } from "./engine.ts";
import { RouteGraph } from "./graph.ts";
import { RULES } from "./cast.ts";
import type { WorldStore } from "./store.ts";
import type { NarrativeProvider } from "../providers/narrative.ts";
import type { IssueResult } from "../rewards/ledger.ts";

export const SHARED_WORLD_ID = "shared-vice";

export function loadScenario() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "data/scenarios/night-shift.json"), "utf8"));
}

export interface Publisher {
  publish(worldId: string, events: StoredEvent[]): void;
  stateChanged(worldId: string, eventsProduced: boolean): void;
}

/**
 * One authoritative in-process simulation. Every mutation of a world goes through `mutate`,
 * which serialises per world, works on a clone, persists (state + events + rewards in one
 * transaction), then swaps the in-memory copy and publishes. A failed write leaves no trace.
 */
export class Simulation {
  readonly engine: Engine;
  private worlds = new Map<string, WorldState>();
  private queues = new Map<string, Promise<unknown>>();
  private activeUntil = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  publisher: Publisher | null = null;

  constructor(private cfg: Config, private store: WorldStore, narrative: NarrativeProvider) {
    const sc = loadScenario();
    this.engine = new Engine(new RouteGraph(sc.routeGraph.nodes, sc.routeGraph.edges), narrative, sc.places);
  }

  get(id: string): WorldState | null {
    if (this.worlds.has(id)) return this.worlds.get(id)!;
    const s = this.store.load(id);
    if (s) this.worlds.set(id, s);
    return s;
  }

  async ensureShared() {
    return this.serial(SHARED_WORLD_ID, async () => {
      const existing = this.get(SHARED_WORLD_ID);
      if (existing) return existing;
      const { state, ...changes } = await this.engine.create(SHARED_WORLD_ID, "shared", null, this.cfg.worldSeed);
      this.store.insert(state, changes);
      this.worlds.set(state.id, state);
      this.publisher?.publish(state.id, changes.events);
      return state;
    });
  }

  async ensureSession(sessionId: string, seed?: string) {
    return this.serial(`create:${sessionId}`, async () => {
      const id = this.store.activeWorldIdFor(sessionId);
      if (id) return this.get(id)!;
      const worldId = `s-${sessionId.slice(0, 12)}-${Date.now().toString(36)}`;
      const { state, ...changes } = await this.engine.create(worldId, "session", sessionId, seed ?? `${this.cfg.worldSeed}:${sessionId}`);
      this.store.insert(state, changes);
      this.worlds.set(state.id, state);
      this.touch(state.id);
      return state;
    });
  }

  async restartSession(sessionId: string, seed?: string) {
    const id = this.store.activeWorldIdFor(sessionId);
    if (id) await this.serial(id, async () => { this.store.archive(id); this.worlds.delete(id); });
    return this.ensureSession(sessionId, seed);
  }

  canView(worldId: string, sessionId: string | null) {
    const o = this.store.ownerOf(worldId);
    if (!o) return false;
    return o.kind === "shared" || (!!sessionId && o.owner_session_id === sessionId);
  }

  touch(worldId: string, ms = 10 * 60_000) {
    this.activeUntil.set(worldId, Date.now() + ms);
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(key, next.catch(() => undefined));
    return next;
  }

  async mutate(worldId: string, fn: (s: WorldState) => Promise<Changes>): Promise<{ state: WorldState; changes: Changes; rewards: IssueResult[] }> {
    return this.serial(worldId, async () => {
      const current = this.get(worldId);
      if (!current) throw new Error(`Unknown world ${worldId}`);
      const draft = structuredClone(current);
      const changes = await fn(draft);
      const rewards = this.store.save(draft, current.seq, changes);
      this.worlds.set(worldId, draft);
      if (changes.events.length) this.publisher?.publish(worldId, changes.events);
      this.publisher?.stateChanged(worldId, changes.events.length > 0);
      return { state: draft, changes, rewards };
    });
  }

  /** Ticks shared world always; session worlds only while recently active (no offline catch-up). */
  start() {
    if (this.timer) return;
    const dt = (this.cfg.tickMs / 1000) * RULES.simRate;
    this.timer = setInterval(() => {
      const now = Date.now();
      const ids = [SHARED_WORLD_ID, ...[...this.activeUntil].filter(([, t]) => t > now).map(([id]) => id)];
      for (const id of ids) {
        if (!this.get(id)) continue;
        this.mutate(id, (s) => this.engine.tick(s, dt)).catch((e) => console.error(`tick ${id} failed:`, e.message));
      }
    }, this.cfg.tickMs);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  get running() { return !!this.timer; }
}
