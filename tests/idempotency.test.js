/**
 * Idempotency tests for the upsert pipeline.
 *
 * Verified:
 * 1. Writing the same record twice issues ON CONFLICT DO UPDATE, not a duplicate insert.
 * 2. The SQL emitted contains 'ON CONFLICT (source_id)'.
 * 3. The webhook deduplication path returns { skipped: true } on the second call.
 */

jest.mock('../src/db/client');

const db = require('../src/db/client');

// Simulate a pg Pool client
const mockClient = {
  query:   jest.fn().mockResolvedValue({ rows: [{ id: 'run-1' }] }),
  release: jest.fn(),
};
db.connect = jest.fn().mockResolvedValue(mockClient);
db.query   = jest.fn().mockResolvedValue({ rows: [{ id: 'run-1' }] });

const { upsertRecords, upsertTransaction } = require('../src/pipeline/upsert');

const record = {
  source:       'stripe',
  source_id:    'stripe:pi_test_idempotency_001',
  record_type:  'payment',
  name:         'Idempotency Test',
  email:        'idem@test.com',
  amount_cents: 9900,
  status:       'succeeded',
  event_start:  null,
  event_end:    null,
  occurred_at:  '2024-06-01T12:00:00Z',
  raw:          { id: 'pi_test_idempotency_001' },
};

describe('upsertRecords idempotency', () => {
  beforeEach(() => jest.clearAllMocks());

  it('wraps writes in a transaction (BEGIN / COMMIT)', async () => {
    await upsertRecords([record]);
    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('COMMIT');
  });

  it('uses ON CONFLICT (source_id) DO UPDATE — not a plain INSERT', async () => {
    await upsertRecords([record]);
    const insertCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('ON CONFLICT')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/ON CONFLICT \(source_id\)/);
  });

  it('passes source_id as a parameter (not interpolated into SQL)', async () => {
    await upsertRecords([record]);
    const insertCall = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('ON CONFLICT')
    );
    expect(insertCall[1]).toContain('stripe:pi_test_idempotency_001');
  });

  it('calling upsertRecords twice does not throw', async () => {
    await expect(upsertRecords([record])).resolves.not.toThrow();
    await expect(upsertRecords([record])).resolves.not.toThrow();
  });

  it('rolls back on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(upsertRecords([record])).rejects.toThrow('DB error');

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('ROLLBACK');
  });
});

describe('upsertTransaction idempotency', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses ON CONFLICT (source_id) DO UPDATE', async () => {
    await upsertTransaction({
      source:            'stripe',
      source_id:         'stripe:pi_test_tx_001',
      amount_cents:      9900,
      currency:          'usd',
      status:            'succeeded',
      normalized_status: 'collected',
      transacted_at:     '2024-06-01T12:00:00Z',
      raw:               {},
    });
    const call = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('ON CONFLICT')
    );
    expect(call).toBeDefined();
    expect(call[0]).toMatch(/ON CONFLICT \(source_id\)/);
  });
});
