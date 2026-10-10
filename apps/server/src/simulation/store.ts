import type { Db } from "../db/database.ts";
import type { Ledger, IssueResult } from "../rewards/ledger.ts";
import type { Changes, StoredEvent, WorldState } from "./engine.ts";

export class ConcurrencyError extends Error {}

export class WorldStore {
  constructor(private db: Db, private ledger: Ledger) {}

  load(id: string): WorldState | null {
    const row = this.db.get<{ state_json: string }>("SELECT state_json FROM worlds WHERE id = ?", id);
    return row ? (JSON.parse(row.state_json) as WorldState) : null;
  }

  activeWorldIdFor(sessionId: string): string | null {
    return this.db.get<{ id: string }>("SELECT id FROM worlds WHERE owner_session_id = ? AND archived = 0", sessionId)?.id ?? null;
  }

  ownerOf(worldId: string) {
    return this.db.get<{ kind: string; owner_session_id: string | null; archived: number }>("SELECT kind, owner_session_id, archived FROM worlds WHERE id = ?", worldId) ?? null;
  }

  insert(state: WorldState, changes: Changes) {
    return this.db.tx(() => {
      this.db.run("INSERT INTO worlds (id, kind, owner_session_id, state_json, seq, sim_time, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        state.id, state.kind, state.ownerSessionId, JSON.stringify(state), state.seq, state.simTime, new Date().toISOString());
      this.appendEvents(changes.events);
      return this.issueRewards(state, changes);
    });
  }

  /**
   * Outbox semantics: state, events and reward entries commit together or not at all.
   * `expectedSeq` makes concurrent writers (e.g. a second process) fail instead of forking history.
   */
  save(state: WorldState, expectedSeq: number, changes: Changes): IssueResult[] {
    return this.db.tx(() => {
      const r = this.db.run("UPDATE worlds SET state_json = ?, seq = ?, sim_time = ?, updated_at = ? WHERE id = ? AND seq = ?",
        JSON.stringify(state), state.seq, state.simTime, new Date().toISOString(), state.id, expectedSeq);
      if (r.changes !== 1) throw new ConcurrencyError(`World ${state.id} changed underneath (expected seq ${expectedSeq})`);
      this.appendEvents(changes.events);
      return this.issueRewards(state, changes);
    });
  }

  archive(worldId: string) {
    this.db.run("UPDATE worlds SET archived = 1 WHERE id = ?", worldId);
  }

  private appendEvents(events: StoredEvent[]) {
    for (const e of events) {
      this.db.run(
        "INSERT INTO events (id, world_id, seq, type, sim_time, created_at, actor_ids, location_id, cause_event_id, visibility, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        e.id, e.worldId, e.sequence, e.type, e.simTime, e.createdAt, JSON.stringify(e.actorIds), e.locationId, e.causeEventId, e.visibility, JSON.stringify(e.payload),
      );
    }
  }

  private issueRewards(state: WorldState, changes: Changes) {
    if (!state.ownerSessionId) return [];
    return changes.rewards.map((c) => this.ledger.issue(c, state.ownerSessionId!));
  }

  eventsAfter(worldId: string, afterSeq: number, limit: number): StoredEvent[] {
    return this.db.all<any>("SELECT * FROM events WHERE world_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?", worldId, afterSeq, limit).map(rowToEvent);
  }

  recent(worldId: string, limit: number): StoredEvent[] {
    return this.db.all<any>("SELECT * FROM (SELECT * FROM events WHERE world_id = ? AND visibility != 'hidden' ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC", worldId, limit).map(rowToEvent);
  }

  event(id: string): StoredEvent | null {
    const r = this.db.get<any>("SELECT * FROM events WHERE id = ?", id);
    return r ? rowToEvent(r) : null;
  }

  maxSeq(worldId: string) {
    return this.db.get<{ m: number | null }>("SELECT MAX(seq) AS m FROM events WHERE world_id = ?", worldId)?.m ?? 0;
  }
}

export function rowToEvent(r: any): StoredEvent {
  return {
    id: r.id, worldId: r.world_id, sequence: r.seq, type: r.type, simTime: r.sim_time, createdAt: r.created_at,
    actorIds: JSON.parse(r.actor_ids), locationId: r.location_id, causeEventId: r.cause_event_id, visibility: r.visibility, payload: JSON.parse(r.payload_json),
  };
}

export function canSee(e: Pick<StoredEvent, "visibility">, sessionId: string | null) {
  return e.visibility === "public" || (!!sessionId && e.visibility === `participant:${sessionId}`);
}
