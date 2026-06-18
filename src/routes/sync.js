const { Router } = require('express');
const { enqueueSyncJobs } = require('../queue/client');
const { syncAllSources, syncSource } = require('../pipeline/sync');
const db = require('../db/client');

const router = Router();

const VALID_SOURCES = ['hubspot', 'google_calendar', 'stripe'];

/**
 * POST /sync/run
 * Enqueue sync jobs for all (or specified) sources via BullMQ.
 * Re-triggering within the same minute is a no-op (deduplicated by jobId).
 *
 * Body (optional): { "sources": ["hubspot", "stripe"] }
 */
router.post('/run', async (req, res) => {
  try {
    const requested = req.body?.sources;
    const sources = Array.isArray(requested)
      ? requested.filter((s) => VALID_SOURCES.includes(s))
      : VALID_SOURCES;

    if (!sources.length) {
      return res.status(400).json({ error: 'No valid sources specified' });
    }

    const jobs = await enqueueSyncJobs(sources);
    res.json({
      status: 'queued',
      sources,
      job_ids: jobs.map((j) => j.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /sync/run/direct
 * Bypass the queue and run all sources synchronously in this request.
 * Useful for testing, demos, and Render's free tier (no separate worker process needed).
 */
router.post('/run/direct', async (req, res) => {
  try {
    const requested = req.body?.sources;
    const sources = Array.isArray(requested)
      ? requested.filter((s) => VALID_SOURCES.includes(s))
      : VALID_SOURCES;

    await Promise.allSettled(sources.map((s) => syncSource(s)));

    const runs = await db.query(
      `SELECT source, status, records_upserted, error_message, started_at, finished_at
       FROM sync_runs
       WHERE started_at > now() - interval '5 minutes'
       ORDER BY started_at DESC`
    );
    res.json({ status: 'completed', runs: runs.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /sync/status
 * Recent sync run history.
 */
router.get('/status', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await db.query(
      `SELECT source, status, records_upserted, error_message, started_at, finished_at
       FROM sync_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ runs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /sync/webhook/:source
 * Receive a webhook event from a source, deduplicate by event ID,
 * then enqueue a sync job for that source.
 *
 * Deduplication: first write wins (UNIQUE on event_id).
 * Duplicate events return 200 with { skipped: true } — not an error.
 */
router.post('/webhook/:source', async (req, res) => {
  const { source } = req.params;
  if (!VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `Unknown source: ${source}` });
  }

  const eventId = req.headers['x-event-id'] || req.body?.id || req.body?.event_id;
  if (!eventId) {
    return res.status(400).json({ error: 'Missing event ID (header x-event-id or body.id)' });
  }

  try {
    await db.query(
      'INSERT INTO processed_webhooks (event_id, source) VALUES ($1, $2)',
      [String(eventId), source]
    );
  } catch (err) {
    if (err.code === '23505') {
      // Duplicate — already processed
      return res.json({ status: 'ok', skipped: true, reason: 'duplicate' });
    }
    return res.status(500).json({ error: err.message });
  }

  try {
    await enqueueSyncJobs([source]);
    res.json({ status: 'queued', source, event_id: eventId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
