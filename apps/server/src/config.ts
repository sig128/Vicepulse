import path from "node:path";
import fs from "node:fs";

export const ROOT = path.resolve(import.meta.dirname, "../../..");

function loadDotEnv() {
  const f = path.join(ROOT, ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDotEnv();

const env = (k: string, d: string) => process.env[k] ?? d;

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  sessionSecret: string;
  allowedOrigins: string[];
  demoControls: boolean;
  worldSeed: string;
  production: boolean;
  tickMs: number;
  narrative: { provider: string; apiBase: string; apiKey: string; model: string; timeoutMs: number; maxTokens: number };
  settlementAdapter: string;
  tileFetchOnDemand: boolean;
  tileFetchDailyBudget: number;
  adminToken: string | null;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === "production";
  const secret = env("SESSION_SECRET", "dev-only-secret-change-me");
  if (production && secret.startsWith("dev-only")) throw new Error("SESSION_SECRET must be set in production");
  return {
    port: Number(env("PORT", "8787")),
    host: env("HOST", "127.0.0.1"),
    databasePath: path.resolve(ROOT, env("DATABASE_PATH", "apps/server/var/vicepulse.db")),
    sessionSecret: secret,
    allowedOrigins: env("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8787,http://127.0.0.1:8787").split(",").map((s) => s.trim()).filter(Boolean),
    demoControls: env("DEMO_CONTROLS", production ? "false" : "true") === "true",
    worldSeed: env("WORLD_SEED", "night-shift-001"),
    production,
    tickMs: Number(env("TICK_MS", "1000")),
    narrative: {
      provider: env("NARRATIVE_PROVIDER", "deterministic"),
      apiBase: env("NARRATIVE_API_BASE", ""),
      apiKey: env("NARRATIVE_API_KEY", ""),
      model: env("NARRATIVE_MODEL", ""),
      timeoutMs: Number(env("NARRATIVE_TIMEOUT_MS", "4000")),
      maxTokens: Number(env("NARRATIVE_MAX_TOKENS", "160")),
    },
    settlementAdapter: env("SETTLEMENT_ADAPTER", "disabled"),
    tileFetchOnDemand: env("TILE_FETCH_ON_DEMAND", "true") === "true",
    tileFetchDailyBudget: Number(env("TILE_FETCH_DAILY_BUDGET", "800")),
    adminToken: process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length >= 24 ? process.env.ADMIN_TOKEN : null,
    ...overrides,
  };
}
