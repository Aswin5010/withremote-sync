const db = require('../db/client');

/**
 * The canonical allow-list of statuses that count as collected revenue.
 * Only statuses in this list contribute to any revenue figure in this codebase.
 * An exclusion list is NOT used — new/unknown statuses are automatically excluded.
 */
const COLLECTED_STATUS = 'collected';

/**
 * THE single source of truth for revenue computation.
 *
 * Both the summary endpoint and the breakdown endpoint call this function.
 * No other revenue computation exists — if you need revenue anywhere else,
 * import and call this function; do not write a second query.
 *
 * @param {Date|string} startDate - inclusive lower bound
 * @param {Date|string} endDate   - exclusive upper bound
 * @returns {{ total_cents: number, transaction_count: number }}
 */
async function computeRevenue(startDate, endDate) {
  const res = await db.query(
    `SELECT
       COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
       COUNT(*)::int                          AS transaction_count
     FROM transactions
     WHERE normalized_status = $1
       AND transacted_at >= $2
       AND transacted_at  < $3`,
    [COLLECTED_STATUS, startDate, endDate]
  );

  return {
    total_cents:       Number(res.rows[0].total_cents),
    transaction_count: Number(res.rows[0].transaction_count),
  };
}

module.exports = { computeRevenue, COLLECTED_STATUS };
