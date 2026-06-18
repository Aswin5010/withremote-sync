const db = require('../db/client');
const { loadCursor, saveCursor, clearCursor } = require('./cursor');
const { upsertRecords, upsertTransaction } = require('./upsert');

const SOURCES = {
  hubspot: {
    fetcher:     require('../sources/hubspot'),
    transformer: require('../transformers/hubspot'),
  },
  google_calendar: {
    fetcher:     require('../sources/google_calendar'),
    transformer: require('../transformers/google_calendar'),
  },
  stripe: {
    fetcher:     require('../sources/stripe'),
    transformer: require('../transformers/stripe'),
  },
};

/**
 * Detect a "stale cursor" error from any source.
 * - Google Calendar returns 410 Gone when syncToken expires
 * - HubSpot returns 400 when the cursor value is unparseable/invalid
 * Both should trigger a full backfill rather than crashing or silently failing.
 */
function isStaleError(err) {
  const status = err?.status || err?.code || err?.response?.status;
  if (status === 410) return true;
  if (status === 400) return true; // invalid cursor value (e.g. HubSpot search API)
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('410') || msg.includes('sync token') || msg.includes('stale');
}

/**
 * Attempt incremental fetch. On stale cursor: clear it and fall back to full.
 */
async function fetchWithFallback(source, fetcher, cursor) {
  if (!cursor) {
    console.log(`[sync:${source}] No cursor — full fetch`);
    return fetcher.fetchFull();
  }

  try {
    console.log(`[sync:${source}] Incremental fetch (cursor=${cursor})`);
    return await fetcher.fetchIncremental(cursor);
  } catch (err) {
    if (isStaleError(err)) {
      console.warn(`[sync:${source}] Stale cursor — falling back to full fetch`);
      await clearCursor(source);
      return fetcher.fetchFull();
    }
    throw err;
  }
}

/**
 * Resolve raw status → normalized status via status_mappings table.
 * Falls back to 'unknown' so unmapped statuses never silently enter revenue.
 */
async function resolveNormalizedStatus(source, rawStatus) {
  if (!rawStatus) return 'unknown';
  const res = await db.query(
    'SELECT normalized_status FROM status_mappings WHERE source = $1 AND raw_status = $2',
    [source, rawStatus]
  );
  return res.rows[0]?.normalized_status || 'unknown';
}

/**
 * For Stripe records: also write to the transactions table for PS2 metrics.
 */
async function syncStripeTransactions(normalizedRecords, rawRecords) {
  for (let i = 0; i < normalizedRecords.length; i++) {
    const n = normalizedRecords[i];
    if (n.record_type !== 'payment') continue;

    const normalizedStatus = await resolveNormalizedStatus('stripe', n.status);
    await upsertTransaction({
      source:            'stripe',
      source_id:         n.source_id,
      amount_cents:      n.amount_cents || 0,
      currency:          rawRecords[i]?.currency || 'usd',
      status:            n.status,
      normalized_status: normalizedStatus,
      transacted_at:     n.occurred_at,
      raw:               n.raw,
    });
  }
}

/**
 * Sync a single source end-to-end.
 * Errors are caught and logged — they do NOT propagate so other sources continue.
 */
async function syncSource(source) {
  if (!SOURCES[source]) throw new Error(`Unknown source: ${source}`);

  const { fetcher, transformer } = SOURCES[source];
  const runId = await startRun(source);

  try {
    const cursor = await loadCursor(source);
    const { records: rawRecords, nextCursor } = await fetchWithFallback(source, fetcher, cursor);

    console.log(`[sync:${source}] Fetched ${rawRecords.length} raw records`);

    const normalized = rawRecords.map((r) => transformer.transform(r));
    const count = await upsertRecords(normalized);

    if (source === 'stripe') {
      await syncStripeTransactions(normalized, rawRecords);
    }

    if (nextCursor) await saveCursor(source, nextCursor);
    await finishRun(runId, 'success', count);
    console.log(`[sync:${source}] Done — ${count} records upserted`);
  } catch (err) {
    console.error(`[sync:${source}] Error:`, err.message);
    await finishRun(runId, 'failed', 0, err.message);
    // Intentionally not re-throwing — other sources must continue
  }
}

/**
 * Run all sources in parallel. Uses allSettled so one failure doesn't block others.
 */
async function syncAllSources() {
  const results = await Promise.allSettled(
    Object.keys(SOURCES).map((source) => syncSource(source))
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.error(`[sync] ${failed.length} source(s) errored during sync`);
  }
}

async function startRun(source) {
  const res = await db.query(
    `INSERT INTO sync_runs (source, status) VALUES ($1, 'running') RETURNING id`,
    [source]
  );
  return res.rows[0].id;
}

async function finishRun(id, status, count, errorMessage = null) {
  await db.query(
    `UPDATE sync_runs
     SET status = $1, records_upserted = $2, error_message = $3, finished_at = now()
     WHERE id = $4`,
    [status, count, errorMessage, id]
  );
}

module.exports = { syncSource, syncAllSources };
