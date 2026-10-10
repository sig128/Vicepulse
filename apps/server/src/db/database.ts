import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.ts";

/**
 * Thin repository base over node:sqlite (synchronous, single process).
 * All multi-step writes go through `tx()`, which uses BEGIN IMMEDIATE so concurrent
 * request handlers serialise on the write lock. A PostgreSQL port would replace this file.
 */
export class Db {
  readonly raw: DatabaseSync;
  private stmts = new Map<string, StatementSync>();
  private depth = 0;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  prep(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }

  run(sql: string, ...params: any[]) { return this.prep(sql).run(...params); }
  get<T = any>(sql: string, ...params: any[]): T | undefined { return this.prep(sql).get(...params) as T | undefined; }
  all<T = any>(sql: string, ...params: any[]): T[] { return this.prep(sql).all(...params) as T[]; }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) { this.depth++; try { return fn(); } finally { this.depth--; } }
    this.raw.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  migrate(): number[] {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const done = new Set(this.all<{ version: number }>("SELECT version FROM schema_migrations").map((r) => r.version));
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", m.version, new Date().toISOString());
      });
      applied.push(m.version);
    }
    return applied;
  }

  close() { this.raw.close(); }
}
