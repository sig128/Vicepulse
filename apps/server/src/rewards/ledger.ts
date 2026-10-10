import crypto from "node:crypto";
import type { Db } from "../db/database.ts";
import type { RewardClaim } from "../simulation/engine.ts";

export interface Campaign {
  id: string; name: string; source: "simulation" | "atlas" | "external_gameplay"; unit: string;
  allocation_total: number; per_user_limit: number; starts_at: string; ends_at: string; enabled: number; rule: string;
}

export const CAMPAIGNS: Campaign[] = [
  { id: "night-shift-s1", name: "The Night Shift — season 1", source: "simulation", unit: "VP_POINTS", allocation_total: 1_000_000, per_user_limit: 250, starts_at: "2026-10-01T00:00:00Z", ends_at: "2027-03-31T23:59:59Z", enabled: 1,
    rule: "250 app points for the first successful delivery per guest session, verified by the server-side simulation. Failed, abandoned or declined runs earn nothing. Replays are playable but not re-rewarded." },
  { id: "finder-s1", name: "Marker Finder — season 1", source: "atlas", unit: "VP_POINTS", allocation_total: 200_000, per_user_limit: 50, starts_at: "2026-10-01T00:00:00Z", ends_at: "2027-03-31T23:59:59Z", enabled: 1,
    rule: "1 app point per 1,000 score per finished game, capped at 50 per guest session. Answers are publicly discoverable, so this is deliberately small." },
  { id: "atlas-contrib-s1", name: "Atlas contributions — season 1", source: "atlas", unit: "VP_POINTS", allocation_total: 100_000, per_user_limit: 500, starts_at: "2026-10-01T00:00:00Z", ends_at: "2027-03-31T23:59:59Z", enabled: 1,
    rule: "25 app points per mapping correction or evidence submission approved by a reviewer." },
  { id: "external-gtavi-s0", name: "External GTA VI gameplay (not active)", source: "external_gameplay", unit: "VP_POINTS", allocation_total: 0, per_user_limit: 0, starts_at: "2026-11-19T00:00:00Z", ends_at: "2026-11-19T00:00:00Z", enabled: 0,
    rule: "Disabled. No authorised verification method for in-game events exists; screenshots alone are not proof." },
];

export type IssueResult =
  | { created: true; entryId: string }
  | { created: false; entryId: string | null; reason: "duplicate" | "campaign_disabled" | "outside_window" | "per_user_limit" | "allocation_exhausted" | "unknown_campaign" };

export class Ledger {
  constructor(private db: Db) {}

  ensureCampaigns() {
    for (const c of CAMPAIGNS) {
      this.db.run(
        `INSERT INTO reward_campaigns (id, name, source, unit, allocation_total, per_user_limit, starts_at, ends_at, enabled, rule)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, rule=excluded.rule, enabled=excluded.enabled, per_user_limit=excluded.per_user_limit, allocation_total=excluded.allocation_total, starts_at=excluded.starts_at, ends_at=excluded.ends_at`,
        c.id, c.name, c.source, c.unit, c.allocation_total, c.per_user_limit, c.starts_at, c.ends_at, c.enabled, c.rule,
      );
    }
  }

  /** Must run inside Db.tx so the triggering outcome and the entry commit together. */
  issue(claim: RewardClaim, sessionId: string, now = new Date()): IssueResult {
    const existing = this.db.get<{ id: string }>("SELECT id FROM reward_entries WHERE idempotency_key = ?", claim.idempotencyKey);
    if (existing) return { created: false, entryId: existing.id, reason: "duplicate" };
    const c = this.db.get<Campaign>("SELECT * FROM reward_campaigns WHERE id = ?", claim.campaignId);
    if (!c) return { created: false, entryId: null, reason: "unknown_campaign" };
    if (!c.enabled) return { created: false, entryId: null, reason: "campaign_disabled" };
    const t = now.toISOString();
    if (t < c.starts_at || t > c.ends_at) return { created: false, entryId: null, reason: "outside_window" };
    const userTotal = this.db.get<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM reward_entries WHERE campaign_id = ? AND session_id = ? AND status != 'void'", c.id, sessionId)!.s;
    if (userTotal + claim.amount > c.per_user_limit) return { created: false, entryId: null, reason: "per_user_limit" };
    const total = this.db.get<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM reward_entries WHERE campaign_id = ? AND status != 'void'", c.id)!.s;
    if (total + claim.amount > c.allocation_total) return { created: false, entryId: null, reason: "allocation_exhausted" };
    const id = crypto.randomUUID();
    this.db.run(
      "INSERT INTO reward_entries (id, campaign_id, session_id, event_id, reason, amount, unit, status, idempotency_key, created_at, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'earned', ?, ?, ?)",
      id, c.id, sessionId, claim.eventId, claim.reason, Math.trunc(claim.amount), c.unit, claim.idempotencyKey, t, JSON.stringify({ demoAssisted: claim.demoAssisted, transferable: false }),
    );
    return { created: true, entryId: id };
  }

  summary(sessionId: string) {
    const entries = this.db.all<any>(
      `SELECT e.*, c.name AS campaign_name, s.state AS settlement_state FROM reward_entries e
       JOIN reward_campaigns c ON c.id = e.campaign_id LEFT JOIN settlements s ON s.entry_id = e.id
       WHERE e.session_id = ? ORDER BY e.created_at DESC`, sessionId,
    ).map((e) => ({ ...e, meta: JSON.parse(e.meta_json), meta_json: undefined }));
    const earned = entries.filter((e) => e.status === "earned").reduce((n, e) => n + e.amount, 0);
    const pending = entries.filter((e) => e.status === "pending").reduce((n, e) => n + e.amount, 0);
    const claimed = entries.filter((e) => e.settlement_state === "confirmed").reduce((n, e) => n + e.amount, 0);
    const campaigns = this.db.all<Campaign & { issued: number }>(
      "SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM reward_entries WHERE campaign_id = c.id AND status != 'void') AS issued FROM reward_campaigns c ORDER BY c.source, c.id",
    );
    return { unit: "VP_POINTS", unitLabel: "app points", totals: { earned, pending, claimed }, entries, campaigns };
  }
}
