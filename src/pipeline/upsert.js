const db = require('../db/client');

const BATCH_SIZE = 200;

/**
 * Upsert normalized records into the `records` table in batches.
 * Uses UNNEST for bulk insert — one SQL statement per batch instead of one per row.
 * Conflict key: source_id — same record arriving twice is a no-op update (idempotent).
 */
async function upsertRecords(records) {
  if (!records.length) return 0;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const sources      = batch.map((r) => r.source);
      const sourceIds    = batch.map((r) => r.source_id);
      const recordTypes  = batch.map((r) => r.record_type);
      const names        = batch.map((r) => r.name);
      const emails       = batch.map((r) => r.email);
      const amounts      = batch.map((r) => r.amount_cents);
      const statuses     = batch.map((r) => r.status);
      const eventStarts  = batch.map((r) => r.event_start);
      const eventEnds    = batch.map((r) => r.event_end);
      const occurredAts  = batch.map((r) => r.occurred_at);
      const raws         = batch.map((r) => JSON.stringify(r.raw));

      await client.query(
        `INSERT INTO records
           (source, source_id, record_type, name, email, amount_cents,
            status, event_start, event_end, occurred_at, raw, updated_at)
         SELECT * FROM UNNEST(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::int[], $7::text[], $8::timestamptz[], $9::timestamptz[],
           $10::timestamptz[], $11::jsonb[], ARRAY(SELECT now() FROM generate_series(1,$12))
         )
         ON CONFLICT (source_id) DO UPDATE SET
           name         = EXCLUDED.name,
           email        = EXCLUDED.email,
           amount_cents = EXCLUDED.amount_cents,
           status       = EXCLUDED.status,
           event_start  = EXCLUDED.event_start,
           event_end    = EXCLUDED.event_end,
           occurred_at  = EXCLUDED.occurred_at,
           raw          = EXCLUDED.raw,
           updated_at   = now()`,
        [sources, sourceIds, recordTypes, names, emails, amounts,
         statuses, eventStarts, eventEnds, occurredAts, raws, batch.length]
      );
    }

    await client.query('COMMIT');
    return records.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Upsert a single transaction row for the metrics service.
 * Conflict key: source_id — same payment arriving twice updates in place.
 */
async function upsertTransaction(t) {
  await db.query(
    `INSERT INTO transactions
       (source, source_id, amount_cents, currency, status, normalized_status, transacted_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_id) DO UPDATE SET
       amount_cents      = EXCLUDED.amount_cents,
       status            = EXCLUDED.status,
       normalized_status = EXCLUDED.normalized_status,
       transacted_at     = EXCLUDED.transacted_at,
       raw               = EXCLUDED.raw`,
    [
      t.source, t.source_id, t.amount_cents, t.currency || 'usd',
      t.status, t.normalized_status, t.transacted_at,
      JSON.stringify(t.raw),
    ]
  );
}

module.exports = { upsertRecords, upsertTransaction };
