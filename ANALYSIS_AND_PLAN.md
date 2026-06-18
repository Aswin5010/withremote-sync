# WithRemote Assignment — Analysis & Plan

---

## Problem Overview

Two independent but related backend problems:

1. **Sync Pipeline** — Ingest records from multiple sources into one normalized schema, reliably and idempotently.
2. **Metrics Service** — Compute a single revenue number that is canonical, drift-proof, and self-consistent across views.

---

## Problem 1: Sync Pipeline

### Sources Required

| Source | API | What we get |
|--------|-----|-------------|
| HubSpot CRM | HubSpot Developer (free) | Contacts, deals — named differently across fields |
| Google Calendar | Google Calendar API (free) | Events — timestamps, attendees, titles |
| Payments Processor | Stripe Test Mode (free) | Invoices/charges — status vocabulary differs |

### Key Challenges & How to Solve Them

#### 1. Field normalization across sources
- Each source names the same concept differently (e.g., `firstname`/`last_name`/`name`, `startTime`/`start.dateTime`/`created`)
- **Solution:** A `transformers/` layer with one file per source. Each file maps raw fields to canonical schema before any DB write.

#### 2. Incremental vs full backfill
- Sources accept a cursor (timestamp or token) for incremental sync
- Cursors can go stale — source returns 410 or rejects the cursor
- **Solution:**
  - Store last successful cursor per source in a `sync_cursors` DB table
  - On each run: attempt incremental fetch with stored cursor
  - On cursor error (410, 400, or stale token): delete cursor, fall back to full fetch, log the event
  - After success: upsert new cursor

#### 3. Idempotent writes (no duplicates)
- Same webhook / job re-run must not produce duplicate rows
- **Solution:**
  - Each normalized record has a stable `source_id` = `{source}:{original_id}` (e.g., `hubspot:12345`)
  - DB table has `UNIQUE(source_id)`
  - All writes use `INSERT ... ON CONFLICT (source_id) DO UPDATE SET ...` (upsert)
  - Webhook deduplication: store `webhook_event_id` in a `processed_webhooks` table; skip if already seen

#### 4. Source isolation (one down does not fail all)
- **Solution:** Each source sync runs in a try/catch. Errors are logged and the source is marked `failed` in `sync_runs` table. Other sources proceed independently. At the end, report partial success.

### Normalized Schema (target DB table: `records`)

```sql
CREATE TABLE records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,           -- 'hubspot' | 'google_calendar' | 'stripe'
  source_id     TEXT NOT NULL UNIQUE,    -- '{source}:{original_id}'
  record_type   TEXT NOT NULL,           -- 'contact' | 'deal' | 'event' | 'payment'
  name          TEXT,
  email         TEXT,
  amount_cents  INTEGER,                 -- for payments
  status        TEXT,                    -- raw status from source
  event_start   TIMESTAMPTZ,
  event_end     TIMESTAMPTZ,
  occurred_at   TIMESTAMPTZ,            -- canonical timestamp (created/updated/event_start)
  raw           JSONB,                   -- full original payload
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sync_cursors (
  source        TEXT PRIMARY KEY,
  cursor        TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  source        TEXT,
  status        TEXT,   -- 'success' | 'partial' | 'failed'
  records_upserted INTEGER,
  error_message TEXT
);

CREATE TABLE processed_webhooks (
  event_id      TEXT PRIMARY KEY,
  source        TEXT,
  received_at   TIMESTAMPTZ DEFAULT now()
);
```

### Pipeline Flow

```
[Scheduler / CLI trigger]
         |
    for each source (parallel, isolated):
      1. load cursor from sync_cursors
      2. attempt incremental fetch(cursor)
         on stale/410: clear cursor, do full fetch
      3. transform raw -> normalized records
      4. upsert into records (ON CONFLICT source_id DO UPDATE)
      5. save new cursor to sync_cursors
      6. write sync_run row (success/failed)
         |
    log summary (X records upserted, Y sources failed)
```

---

## Problem 2: Metrics Service

### Core Principle
Use an **allow-list** of statuses that count as "collected revenue":
```
COLLECTED_STATUSES = ['paid', 'succeeded', 'completed']
```
Any status NOT on this list is excluded. New statuses added by a source never silently inflate revenue.

### Schema (in Supabase Postgres)

```sql
CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL UNIQUE,
  amount_cents    INTEGER NOT NULL,
  currency        TEXT DEFAULT 'usd',
  status          TEXT NOT NULL,           -- raw status from source
  normalized_status TEXT NOT NULL,         -- 'collected' | 'pending' | 'failed' | 'refunded'
  transacted_at   TIMESTAMPTZ NOT NULL,
  raw             JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_transactions_date   ON transactions(transacted_at);
CREATE INDEX idx_transactions_status ON transactions(normalized_status);

CREATE TABLE status_mappings (
  source            TEXT NOT NULL,
  raw_status        TEXT NOT NULL,
  normalized_status TEXT NOT NULL,
  PRIMARY KEY (source, raw_status)
);

-- Seed:
INSERT INTO status_mappings VALUES
  ('stripe',  'paid',       'collected'),
  ('stripe',  'succeeded',  'collected'),
  ('stripe',  'pending',    'pending'),
  ('stripe',  'failed',     'failed'),
  ('stripe',  'refunded',   'refunded'),
  ('hubspot', 'completed',  'collected'),
  ('hubspot', 'voided',     'voided');
```

### Two Endpoints, One Computation Function

```
GET /metrics/revenue?start=2024-01-01&end=2024-12-31
-> { total_cents, currency, period }

GET /metrics/revenue/breakdown?start=2024-01-01&end=2024-12-31&granularity=day
-> { breakdown: [ { date, total_cents } ], grand_total_cents }
```

Both call the same `computeRevenue(start, end)` function. The breakdown sums per-period slices using the same function, and `grand_total_cents` must equal the summary total — asserted in the response handler and in tests.

### Drift Prevention Strategy

- `computeRevenue()` lives in exactly one file: `src/metrics/revenue.js`
- Both endpoints import it — no copy-pasted SQL
- A Jest test asserts: `sum(breakdown[].total_cents) === summary.total_cents`
- Adding a new source requires only inserting rows into `status_mappings` — no code change
- New unknown statuses are excluded automatically (allow-list, not exclusion-list)

---

## Project Structure

```
withremote/
├── ANALYSIS_AND_PLAN.md
├── README.md
├── package.json
├── .env.example
├── src/
│   ├── db/
│   │   ├── client.js
│   │   └── migrations/
│   │       ├── 001_records.sql
│   │       ├── 002_sync.sql
│   │       └── 003_transactions.sql
│   ├── sources/
│   │   ├── hubspot.js          -- fetch + cursor logic
│   │   ├── google_calendar.js
│   │   └── stripe.js
│   ├── transformers/
│   │   ├── hubspot.js          -- raw -> normalized record
│   │   ├── google_calendar.js
│   │   └── stripe.js
│   ├── pipeline/
│   │   ├── sync.js             -- orchestrator: runs all sources isolated
│   │   ├── upsert.js           -- idempotent DB write
│   │   └── cursor.js           -- load/save/clear cursor
│   ├── metrics/
│   │   ├── revenue.js          -- THE single computeRevenue() function
│   │   └── breakdown.js        -- date bucketing (calls revenue.js)
│   ├── routes/
│   │   ├── sync.js             -- POST /sync/run
│   │   └── metrics.js          -- GET /metrics/revenue*
│   └── app.js
├── scripts/
│   ├── seed_hubspot.js
│   ├── seed_stripe.js
│   └── seed_gcal.js
└── tests/
    ├── pipeline.test.js
    ├── revenue.test.js         -- asserts summary == sum(breakdown)
    └── idempotency.test.js
```

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Runtime | Node.js + Express | Fast to write, great API client ecosystem |
| Database | Supabase (free Postgres) | Required by PS2; also used for PS1 |
| CRM | HubSpot Developer (free) | Required |
| Calendar | Google Calendar API (free) | Required |
| Payments | Stripe Test Mode (free) | Best free test data; status vocabulary matches PS2 |
| Deployment | Render free tier | Required |
| Testing | Jest | Simple, fast |

---

## Tradeoffs

- **Stripe doubles as both PS1 payment source and PS2 transaction source** — avoids needing a 4th free account
- **No message queue** — sync is triggered by HTTP POST or cron; acceptable for demo scale
- **Cursor stale fallback is logged** — in production you'd alert on this; here we log to `sync_runs`
- **`status_mappings` table** makes normalization data-driven; adding a source requires no code change
- **Both metric endpoints call `computeRevenue()` directly** — no separate aggregation logic that can drift
- **Supabase free tier** — 500MB, sufficient for this demo

---

## Implementation Order

1. [ ] Set up Supabase project + run migrations
2. [ ] Seed scripts (HubSpot contacts/deals, Stripe invoices, Google Calendar events)
3. [ ] Source fetch modules with cursor/incremental logic
4. [ ] Transformer modules (field normalization per source)
5. [ ] Pipeline orchestrator (source isolation, upsert, cursor management)
6. [ ] Metrics `computeRevenue()` + two endpoints
7. [ ] Tests (idempotency, revenue drift assertion)
8. [ ] Express app + routes wired up
9. [ ] Deploy to Render
10. [ ] README + demo video
