CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS records (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT        NOT NULL,
  source_id    TEXT        NOT NULL,
  record_type  TEXT        NOT NULL,
  name         TEXT,
  email        TEXT,
  amount_cents INTEGER,
  status       TEXT,
  event_start  TIMESTAMPTZ,
  event_end    TIMESTAMPTZ,
  occurred_at  TIMESTAMPTZ,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT records_source_id_unique UNIQUE (source_id)
);

CREATE INDEX IF NOT EXISTS idx_records_source      ON records(source);
CREATE INDEX IF NOT EXISTS idx_records_occurred_at ON records(occurred_at);

CREATE TABLE IF NOT EXISTS sync_cursors (
  source     TEXT        PRIMARY KEY,
  cursor     TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source           TEXT        NOT NULL,
  status           TEXT        NOT NULL,  -- 'running' | 'success' | 'failed'
  records_upserted INTEGER     NOT NULL DEFAULT 0,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id    TEXT        PRIMARY KEY,
  source      TEXT        NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
