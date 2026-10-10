import crypto from "node:crypto";
import type { Db } from "../db/database.ts";

/**
 * Converts an earned ledger entry into an external transfer. No chain, token, contract or
 * treasury is configured in this build, so the default adapter refuses every request.
 * A real adapter needs: nonce-signed wallet ownership proof, server-side signing, replay
 * prevention, confirmation tracking and an audited settlement design (docs/REWARDS.md).
 */
export interface RewardSettlementAdapter {
  readonly id: string;
  readonly enabled: boolean;
  readonly description: string;
  submit(entry: { id: string; amount: number; unit: string }): Promise<{ state: "pending" | "confirmed" | "failed"; txRef: string | null }>;
}

export class DisabledSettlement implements RewardSettlementAdapter {
  readonly id = "disabled";
  readonly enabled = false;
  readonly description = "Settlement is disabled. Nothing is ever paid out.";
  async submit(): Promise<never> { throw new Error(this.description); }
}

/** Test-only adapter. Never selectable in production. */
export class MockSettlement implements RewardSettlementAdapter {
  readonly id = "mock";
  readonly enabled = true;
  readonly description = "Local mock settlement for automated tests. Moves nothing.";
  async submit() { return { state: "confirmed" as const, txRef: `mock-${crypto.randomUUID()}` }; }
}

export class SettlementService {
  constructor(private db: Db, readonly adapter: RewardSettlementAdapter) {}

  async claim(entryId: string, sessionId: string) {
    if (!this.adapter.enabled) return { ok: false as const, code: "settlement_disabled", message: this.adapter.description };
    // Reservation is the uniqueness point: one settlement row per entry, ever.
    const reserved = this.db.tx(() => {
      const e = this.db.get<any>("SELECT * FROM reward_entries WHERE id = ? AND session_id = ? AND status = 'earned'", entryId, sessionId);
      if (!e) return { error: "not_found" as const };
      const meta = JSON.parse(e.meta_json);
      if (meta.demoAssisted) return { error: "demo_assisted" as const };
      const existing = this.db.get<any>("SELECT * FROM settlements WHERE entry_id = ?", entryId);
      if (existing) return { error: "already_settled" as const, existing };
      const id = crypto.randomUUID(), t = new Date().toISOString();
      this.db.run("INSERT INTO settlements (id, entry_id, adapter, state, created_at, updated_at) VALUES (?, ?, ?, 'reserved', ?, ?)", id, entryId, this.adapter.id, t, t);
      return { id, entry: e };
    });
    if ("error" in reserved) return { ok: false as const, code: reserved.error, message: reserved.error };
    try {
      const r = await this.adapter.submit({ id: entryId, amount: reserved.entry.amount, unit: reserved.entry.unit });
      this.db.run("UPDATE settlements SET state = ?, tx_ref = ?, updated_at = ? WHERE id = ?", r.state, r.txRef, new Date().toISOString(), reserved.id);
      return { ok: true as const, state: r.state, txRef: r.txRef };
    } catch (e) {
      this.db.run("UPDATE settlements SET state = 'failed', updated_at = ? WHERE id = ?", new Date().toISOString(), reserved.id);
      return { ok: false as const, code: "settlement_failed", message: String(e) };
    }
  }
}

export function createSettlement(kind: string, production: boolean): RewardSettlementAdapter {
  if (kind === "mock" && !production) return new MockSettlement();
  return new DisabledSettlement();
}
