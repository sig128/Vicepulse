export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('shared','session')),
  owner_session_id TEXT REFERENCES sessions(id),
  state_json TEXT NOT NULL,
  seq INTEGER NOT NULL,
  sim_time REAL NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX worlds_owner ON worlds(owner_session_id) WHERE owner_session_id IS NOT NULL AND archived = 0;

-- Append-only event log; doubles as the realtime outbox (published only after commit).
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  sim_time REAL NOT NULL,
  created_at TEXT NOT NULL,
  actor_ids TEXT NOT NULL,
  location_id TEXT,
  cause_event_id TEXT,
  visibility TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (world_id, seq)
);
CREATE INDEX events_world_seq ON events(world_id, seq);

CREATE TABLE annotations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  shapes_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE finder_games (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  total_score INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL
);
CREATE INDEX finder_games_score ON finder_games(total_score DESC) WHERE finished_at IS NOT NULL;

CREATE TABLE reward_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('simulation','atlas','external_gameplay')),
  unit TEXT NOT NULL,
  allocation_total INTEGER NOT NULL CHECK (allocation_total >= 0),
  per_user_limit INTEGER NOT NULL CHECK (per_user_limit >= 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  rule TEXT NOT NULL
);

-- Append-only integer ledger. Status changes are new rows referencing the original via meta.
CREATE TABLE reward_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reward_campaigns(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  event_id TEXT,
  reason TEXT NOT NULL,
  amount INTEGER NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','earned','void')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  meta_json TEXT NOT NULL
);
CREATE INDEX reward_entries_session ON reward_entries(session_id);

CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE REFERENCES reward_entries(id),
  adapter TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved','pending','confirmed','failed','expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tx_ref TEXT
);

CREATE TABLE evidence_submissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL,
  record_id TEXT,
  note TEXT NOT NULL,
  url TEXT,
  proposed_x REAL,
  proposed_y REAL,
  file_name TEXT,
  state TEXT NOT NULL CHECK (state IN ('submitted','under_review','approved','rejected','reward_eligible')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT
);

CREATE TABLE narrative_cache (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TRIGGER reward_entries_no_update BEFORE UPDATE ON reward_entries BEGIN SELECT RAISE(ABORT, 'reward_entries is append-only'); END;
CREATE TRIGGER reward_entries_no_delete BEFORE DELETE ON reward_entries BEGIN SELECT RAISE(ABORT, 'reward_entries is append-only'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
`,
  },
];
