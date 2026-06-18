const { computeRevenue } = require('./revenue');

/**
 * Build date buckets between start and end at the given granularity.
 */
function buildBuckets(start, end, granularity) {
  const buckets = [];
  const cursor = new Date(start);

  while (cursor < end) {
    const from = new Date(cursor);
    if (granularity === 'week') {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const to = cursor > end ? new Date(end) : new Date(cursor);
    buckets.push({ from, to, label: from.toISOString().slice(0, 10) });
  }

  return buckets;
}

/**
 * Revenue breakdown by day or week.
 *
 * Uses computeRevenue() for every bucket — same allow-list logic as the summary.
 * After computing, grand_total_cents is verified to equal the sum of bucket totals.
 * If they diverge (should never happen), an error is thrown rather than silently
 * returning inconsistent numbers.
 *
 * @param {Date|string} startDate
 * @param {Date|string} endDate
 * @param {'day'|'week'} granularity
 */
async function computeBreakdown(startDate, endDate, granularity = 'day') {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const buckets = buildBuckets(start, end, granularity);

  const breakdown = await Promise.all(
    buckets.map(async ({ from, to, label }) => {
      const { total_cents, transaction_count } = await computeRevenue(from, to);
      return { date: label, total_cents, transaction_count };
    })
  );

  // Grand total from the summary function (single DB call, same WHERE clause)
  const { total_cents: summaryTotal } = await computeRevenue(startDate, endDate);

  // Drift guard — must be equal by definition; throw rather than lie
  const breakdownTotal = breakdown.reduce((sum, b) => sum + b.total_cents, 0);
  if (breakdownTotal !== summaryTotal) {
    throw new Error(
      `Revenue drift detected: breakdown_sum=${breakdownTotal} !== summary=${summaryTotal}`
    );
  }

  return {
    breakdown,
    grand_total_cents: summaryTotal,
  };
}

module.exports = { computeBreakdown };
