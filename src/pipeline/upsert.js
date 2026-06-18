const db = require('../db/client');

/**
 * Upsert normalized records into the `records` table.
 * Conflict key: source_id — same record arriving twice is a no-op update (idempotent).
 */
async function upsertRecords(records) {
  if (!records.length) return 0;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const r of records) {
      await client.query(
        `INSERT INTO records
           (source, source_id, record_type, name, email, amount_cents,
            status, event_start, event_end, occurred_at, raw, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
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
        [
          r.source, r.source_id, r.record_type, r.name, r.email,
          r.amount_cents, r.status, r.event_start, r.event_end,
          r.occurred_at, JSON.stringify(r.raw),
        ]
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
