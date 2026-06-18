const { Router } = require('express');
const { computeRevenue } = require('../metrics/revenue');
const { computeBreakdown } = require('../metrics/breakdown');

const router = Router();

function parseDate(str, fallback) {
  if (!str) return fallback;
  const d = new Date(str);
  return isNaN(d.getTime()) ? fallback : d;
}

function centsToDisplay(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * GET /metrics/revenue?start=2024-01-01&end=2024-12-31
 *
 * Returns total collected revenue for the date range.
 * Uses the canonical computeRevenue() — the only revenue calculation in the codebase.
 */
router.get('/revenue', async (req, res) => {
  const start = parseDate(req.query.start, new Date('2000-01-01'));
  const end   = parseDate(req.query.end,   new Date());

  try {
    const { total_cents, transaction_count } = await computeRevenue(start, end);
    res.json({
      total_cents,
      total_dollars:     centsToDisplay(total_cents),
      transaction_count,
      period: {
        start: start.toISOString(),
        end:   end.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /metrics/revenue/breakdown?start=2024-01-01&end=2024-12-31&granularity=day
 *
 * Returns the same total broken down by day or week.
 * grand_total_cents is guaranteed to equal GET /metrics/revenue for the same range.
 * If a drift is detected, a 500 is returned rather than lying.
 */
router.get('/revenue/breakdown', async (req, res) => {
  const start       = parseDate(req.query.start, new Date('2000-01-01'));
  const end         = parseDate(req.query.end,   new Date());
  const granularity = ['day', 'week'].includes(req.query.granularity)
    ? req.query.granularity
    : 'day';

  try {
    const { breakdown, grand_total_cents } = await computeBreakdown(start, end, granularity);
    res.json({
      breakdown: breakdown.map((b) => ({
        ...b,
        total_dollars: centsToDisplay(b.total_cents),
      })),
      grand_total_cents,
      grand_total_dollars: centsToDisplay(grand_total_cents),
      granularity,
      period: {
        start: start.toISOString(),
        end:   end.toISOString(),
      },
    });
  } catch (err) {
    // Revenue drift errors surface as 500 so callers know to investigate
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
