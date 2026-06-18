CREATE TABLE IF NOT EXISTS transactions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT        NOT NULL,
  source_id         TEXT        NOT NULL,
  amount_cents      INTEGER     NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'usd',
  status            TEXT        NOT NULL,
  normalized_status TEXT        NOT NULL,
  transacted_at     TIMESTAMPTZ NOT NULL,
  raw               JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transactions_source_id_unique UNIQUE (source_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date        ON transactions(transacted_at);
CREATE INDEX IF NOT EXISTS idx_transactions_norm_status ON transactions(normalized_status);
CREATE INDEX IF NOT EXISTS idx_transactions_source      ON transactions(source);
