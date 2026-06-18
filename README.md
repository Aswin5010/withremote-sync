# WithRemote — Sync Pipeline & Metrics Service

A backend system that:
1. Ingests records from HubSpot, Google Calendar, and Stripe into a single normalized Postgres schema
2. Exposes a revenue metrics API with a drift-proof, allow-list-based revenue computation

---

## Demo Video

[Watch the demo recording](./Screen%20Recording%202026-06-19%20at%201.00.19%E2%80%AFAM.mov)

Covers: live sync run across all 3 sources, revenue metrics endpoints, idempotency and stale-cursor edge cases.

---

## Live Deployment (Render)

**Base URL: `https://withremote-sync.onrender.com`**

```
POST /sync/run/direct      — run all three sources synchronously
GET  /sync/status          — recent sync run history
GET  /metrics/revenue      — total collected revenue
GET  /metrics/revenue/breakdown  — day-by-day breakdown
GET  /health               — liveness check
```

> Note: Render free tier spins down after 15 minutes of inactivity. First request may take ~30s to wake up.

---

## Running Locally

### Prerequisites
- Node.js 18+
- A Redis instance (local or Upstash free tier)
- A Supabase project (free tier)
- HubSpot developer account (free private app)
- Stripe test mode account (free)
- Google Cloud project with Calendar API enabled (free)

### Setup

```bash
git clone https://github.com/Aswin5010/withremote-sync
cd withremote
npm install
cp .env.example .env
# Fill in all values in .env
```

### First-time Google Calendar OAuth
```bash
# Start a local server to receive the OAuth callback and print the refresh token
npm run gcal:auth
# Follow the printed URL, authenticate, copy GCAL_REFRESH_TOKEN into .env
```

### Run migrations
```bash
npm run migrate
```

### Seed sample data
```bash
npm run seed:hubspot    # Creates 5 sample HubSpot contacts
npm run seed:stripe     # Creates 5 test PaymentIntents (mix of statuses)
npm run seed:gcal       # Creates 5 upcoming Google Calendar events
# or all at once:
npm run seed
```

### Start the server
```bash
npm run dev    # nodemon (auto-reload)
npm start      # production
```

The server starts on `PORT` (default 3000) and also boots the BullMQ worker in the same process.

### Run tests
```bash
npm test
```

---

## API Reference

### Sync

```
POST /sync/run
Body (optional): { "sources": ["hubspot", "stripe"] }
→ Enqueues jobs in BullMQ. Returns job IDs.

POST /sync/run/direct
Body (optional): { "sources": ["hubspot", "stripe"] }
→ Bypasses queue, runs synchronously. Returns results immediately.
   Use this for demos and Render's free tier.

GET /sync/status?limit=20
→ Recent sync run history (source, status, records_upserted, error_message).

POST /sync/webhook/:source
Headers: x-event-id: <unique-event-id>
→ Deduplicated webhook receiver. Second call with same event ID returns { skipped: true }.
```

### Metrics

```
GET /metrics/revenue?start=2024-01-01&end=2024-12-31
→ {
    total_cents: 34700,
    total_dollars: "347.00",
    transaction_count: 3,
    period: { start, end }
  }

GET /metrics/revenue/breakdown?start=2024-01-01&end=2024-12-31&granularity=day
→ {
    breakdown: [ { date, total_cents, total_dollars, transaction_count }, ... ],
    grand_total_cents: 34700,
    grand_total_dollars: "347.00",
    granularity: "day",
    period: { start, end }
  }

Both endpoints use the same computeRevenue() function.
grand_total_cents in the breakdown always equals the summary total — asserted at runtime.
```

---

## Architecture

```
HTTP trigger
    │
    ▼
BullMQ Queue (Redis)          ← job deduplication via minute-bucket jobId
    │
    ▼
Worker (concurrency=3)
    │
    ├── syncSource('hubspot')
    ├── syncSource('google_calendar')   ← run in parallel, isolated per source
    └── syncSource('stripe')
            │
            ├── loadCursor()            ← sync_cursors table
            ├── fetchIncremental(cursor)
            │   └── on 410/stale → clearCursor() + fetchFull()
            ├── transformer.transform() ← per-source field mapping
            ├── upsertRecords()         ← ON CONFLICT (source_id) DO UPDATE
            ├── syncStripeTransactions() ← also writes to transactions table
            └── saveCursor()
```

### Why BullMQ?

- Retries with exponential backoff (3 attempts) without any extra code
- Job deduplication by `jobId` — re-triggering within the same minute is a no-op
- `concurrency: 3` lets all sources run in parallel without managing raw `Promise.all`
- Scales to a separate worker process/service by changing one env var — no code change
- Free with any Redis instance (Upstash free tier works on Render)

For this demo, the worker runs in the same process as Express. To scale out:
1. Remove `require('./queue/worker')` from `src/app.js`
2. Add a second Render service running `npm run worker`

---

## Key Design Decisions

### Idempotency
Every record has a `source_id = "{source}:{original_id}"`. All writes are `INSERT ... ON CONFLICT (source_id) DO UPDATE`. Running the same sync twice or receiving the same webhook twice produces no duplicate rows.

Webhooks are further deduplicated by `event_id` in the `processed_webhooks` table (unique constraint, first write wins).

### Stale cursor fallback
On 410 or any error matching "sync token"/"stale", the cursor is cleared and a full backfill runs. This is logged in `sync_runs` so it's visible, not silent.

### Source isolation
Each source runs in its own try/catch. A HubSpot outage does not prevent Stripe and Google Calendar from syncing. `syncAllSources` uses `Promise.allSettled` (not `Promise.all`) for the same reason.

### Revenue allow-list
`computeRevenue()` filters `WHERE normalized_status = 'collected'`. Only statuses explicitly mapped to `'collected'` in `status_mappings` count. A new status from a new source is `'unknown'` by default and never leaks into revenue.

### Single source of truth for revenue
`src/metrics/revenue.js:computeRevenue()` is the only place revenue is calculated. Both `/metrics/revenue` and `/metrics/revenue/breakdown` import and call it. The breakdown asserts `sum(buckets) === summary` at runtime and returns 500 if they ever diverge.

### Field normalization
Each source has a dedicated transformer (`src/transformers/`). Raw payloads are stored in `raw JSONB` so nothing is lost.

---

## Tradeoffs

| Decision | What was traded off |
|----------|---------------------|
| Worker co-located with Express in same process | Simpler Render deployment; scales by separating to second service |
| No TypeScript | Faster to write for a demo; types are evident from structure |
| Raw `pg` instead of ORM | Explicit upsert SQL is clearer; ORMs obscure `ON CONFLICT` behaviour |
| Stripe as both sync source and transaction source | Avoids a 4th free account; Stripe's status vocabulary is the richest for PS2 demo |
| No schema version table for migrations | Scripts are idempotent (`IF NOT EXISTS`); fine for this scale |

---

## Sources & References

- HubSpot Node.js API Client: https://github.com/HubSpot/hubspot-api-nodejs
- Google Calendar API (Node): https://googleapis.dev/nodejs/googleapis/latest/calendar/
- Stripe Node.js SDK: https://github.com/stripe/stripe-node
- BullMQ docs: https://docs.bullmq.io
- Supabase connection pooling with `pg`: https://supabase.com/docs/guides/database/connecting-to-postgres
- Upstash Redis free tier: https://upstash.com
- Render free tier deployment: https://render.com/docs/free

---

## AI Usage

This project was built with Claude (Anthropic). The full conversation is shared at: `<link>`.

Claude was used to scaffold the project structure, write boilerplate, and reason through edge cases (stale cursor detection, idempotency patterns, the allow-list vs exclusion-list tradeoff). All architecture decisions, design tradeoffs, and final code review were done by the developer.
