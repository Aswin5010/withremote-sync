# AI Usage

This project was built using **Claude (Anthropic)** as a coding assistant via Claude Code CLI.

---

## What Claude was used for

### Scaffolding
- Generating the initial project structure and file layout
- Writing boilerplate (Express routes, pg pool setup, BullMQ client config)
- Creating seed scripts for HubSpot, Stripe, and Google Calendar

### Architecture reasoning
- Talking through the allow-list vs exclusion-list tradeoff for revenue status normalization
- Deciding on `source_id = "{source}:{original_id}"` as the idempotency key
- Choosing `ON CONFLICT (source_id) DO UPDATE` over application-level dedup
- Deciding to run the BullMQ worker in the same process as Express for Render's free tier

### Debugging
- Diagnosing HubSpot 401 → wrong token type (Personal Access Key vs Private App token)
- Diagnosing HubSpot 400 → `dealstage` is a Deals property, not a Contacts property — switched to `lifecyclestage`
- Diagnosing Google Calendar "Premature close" on Render free tier → gaxios and Node native fetch both fail; fixed by rewriting to use Node's native `https.request` with `keepAlive: false`
- Diagnosing Supabase connection → `db.cpumymkyfowgdkolnuwy.supabase.co` not resolving → switched to Session Pooler URL
- Diagnosing stale cursor detection missing HubSpot 400 → broadened `isStaleError()` to handle both 400 and 410

### Code written by Claude, reviewed and accepted
- `src/pipeline/sync.js` — orchestrator with stale cursor fallback and source isolation
- `src/pipeline/upsert.js` — batched UNNEST upserts (200 rows/statement)
- `src/metrics/revenue.js` — single `computeRevenue()` function
- `src/metrics/breakdown.js` — drift guard asserting `sum(buckets) === summary`
- `src/sources/google_calendar.js` — native https rewrite for Render compatibility
- All DB migrations and tests

---

## What was directed and decided by the developer

- Choice of tech stack (Node.js, Supabase, BullMQ, Upstash, Render)
- Decision to use Stripe as both the PS1 payments source and PS2 transaction source
- Scoping Google Calendar full fetch to a 1-week window instead of pulling full history
- Rejecting certain git history rewrites and choosing safer alternatives
- Account setup for HubSpot, Stripe, Google Cloud, Supabase, and Upstash
- Final review and approval of all committed code

---

## What Claude got wrong (and was corrected)

| Mistake | Correction |
|---------|-----------|
| Used `dealstage` (a Deals property) on HubSpot Contacts | Switched to `lifecyclestage` |
| Initial stale cursor detection only handled 410 | Broadened to also catch 400 (HubSpot's response for invalid cursors) |
| Used gaxios-based googleapis client for Google Calendar | Rewrote to native `https.request` with `keepAlive:false` after Render network failures |
| Batch upsert initially used row-by-row inserts | Rewrote to UNNEST batching after 5094-record GCal sync was too slow |
| `.env.example` placeholder `sk_test_xxx` triggered GitHub push protection | Replaced with a non-matching placeholder |
