/**
 * Tests for the revenue metrics service.
 *
 * Key invariants verified:
 * 1. Only 'collected' normalized_status contributes to revenue (allow-list).
 * 2. Unknown/new status values are excluded automatically.
 * 3. breakdown grand_total_cents always equals the summary total.
 */

jest.mock('../src/db/client');

const db = require('../src/db/client');
const { computeRevenue, COLLECTED_STATUS } = require('../src/metrics/revenue');
const { computeBreakdown }                 = require('../src/metrics/breakdown');

// In-memory transaction fixture
const TRANSACTIONS = [
  { normalized_status: 'collected', amount_cents: 9900,  transacted_at: '2024-01-15T10:00:00Z' },
  { normalized_status: 'collected', amount_cents: 4900,  transacted_at: '2024-01-22T10:00:00Z' },
  { normalized_status: 'collected', amount_cents: 19900, transacted_at: '2024-02-03T10:00:00Z' },
  { normalized_status: 'pending',   amount_cents: 9900,  transacted_at: '2024-01-10T10:00:00Z' },
  { normalized_status: 'failed',    amount_cents: 5000,  transacted_at: '2024-01-05T10:00:00Z' },
  { normalized_status: 'unknown',   amount_cents: 99999, transacted_at: '2024-01-20T10:00:00Z' }, // new status
  { normalized_status: 'refunded',  amount_cents: 4900,  transacted_at: '2024-01-25T10:00:00Z' },
];

// Mock db.query to run the allow-list filter in memory
db.query.mockImplementation(async (sql, params) => {
  const [status, start, end] = params;
  const filtered = TRANSACTIONS.filter(
    (t) =>
      t.normalized_status === status &&
      new Date(t.transacted_at) >= new Date(start) &&
      new Date(t.transacted_at) < new Date(end)
  );
  const total = filtered.reduce((sum, t) => sum + t.amount_cents, 0);
  return { rows: [{ total_cents: total, transaction_count: filtered.length }] };
});

describe('computeRevenue — allow-list correctness', () => {
  it('sums only collected transactions', async () => {
    const { total_cents } = await computeRevenue('2024-01-01', '2024-03-01');
    // 9900 + 4900 + 19900 = 34700
    expect(total_cents).toBe(34700);
  });

  it('excludes pending transactions', async () => {
    const { total_cents } = await computeRevenue('2024-01-01', '2024-03-01');
    expect(total_cents).toBe(34700); // pending 9900 is NOT included
  });

  it('excludes unknown/new status values automatically', async () => {
    // The 'unknown' transaction with 99999 cents must NOT appear in revenue
    const { total_cents } = await computeRevenue('2024-01-01', '2024-03-01');
    expect(total_cents).toBeLessThan(99999);
  });

  it('returns zero for a date range with no transactions', async () => {
    const { total_cents } = await computeRevenue('2020-01-01', '2020-12-31');
    expect(total_cents).toBe(0);
  });

  it('respects date range boundaries (exclusive end)', async () => {
    // Only the Jan transactions; Feb one is out
    const { total_cents } = await computeRevenue('2024-01-01', '2024-02-01');
    expect(total_cents).toBe(9900 + 4900); // 14800
  });

  it('COLLECTED_STATUS is a single named constant, not an ad-hoc string', () => {
    expect(COLLECTED_STATUS).toBe('collected');
  });
});

describe('breakdown vs summary consistency', () => {
  it('grand_total_cents equals sum of all bucket totals', async () => {
    const { breakdown, grand_total_cents } = await computeBreakdown(
      '2024-01-01', '2024-03-01', 'day'
    );
    const sumFromBuckets = breakdown.reduce((s, b) => s + b.total_cents, 0);
    expect(sumFromBuckets).toBe(grand_total_cents);
  });

  it('grand_total_cents (breakdown) equals computeRevenue for same range', async () => {
    const { grand_total_cents } = await computeBreakdown('2024-01-01', '2024-03-01', 'day');
    const { total_cents }       = await computeRevenue('2024-01-01', '2024-03-01');
    expect(grand_total_cents).toBe(total_cents);
  });

  it('weekly granularity totals match the summary', async () => {
    const { grand_total_cents } = await computeBreakdown('2024-01-01', '2024-03-01', 'week');
    const { total_cents }       = await computeRevenue('2024-01-01', '2024-03-01');
    expect(grand_total_cents).toBe(total_cents);
  });
});
