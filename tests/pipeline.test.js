/**
 * Tests for the sync pipeline orchestrator.
 *
 * Verified:
 * 1. syncSource does NOT throw when a source errors — other sources must continue.
 * 2. When an incremental fetch returns a 410, cursor is cleared and full fetch runs.
 * 3. After a successful sync, the cursor is saved with the new value.
 * 4. Unknown sources throw immediately (caught by the caller).
 */

jest.mock('../src/db/client');
jest.mock('../src/pipeline/cursor');
jest.mock('../src/pipeline/upsert');
jest.mock('../src/sources/hubspot');
jest.mock('../src/sources/google_calendar');
jest.mock('../src/sources/stripe');

const db          = require('../src/db/client');
const cursor      = require('../src/pipeline/cursor');
const upsert      = require('../src/pipeline/upsert');
const hubspot     = require('../src/sources/hubspot');

const { syncSource } = require('../src/pipeline/sync');

const MOCK_RECORD = {
  id: '1',
  properties: {
    firstname: 'Alice', lastname: 'Test',
    email: 'alice@test.com', lastmodifieddate: '2024-01-01',
  },
};

beforeEach(() => {
  jest.clearAllMocks();

  // Default DB mock: startRun returns an ID, finishRun and resolveNormalizedStatus succeed
  db.query.mockResolvedValue({ rows: [{ id: 'run-uuid-1' }] });

  cursor.loadCursor.mockResolvedValue(null);
  cursor.saveCursor.mockResolvedValue();
  cursor.clearCursor.mockResolvedValue();

  upsert.upsertRecords.mockResolvedValue(1);
  upsert.upsertTransaction.mockResolvedValue();

  hubspot.fetchFull.mockResolvedValue({
    records: [MOCK_RECORD],
    nextCursor: '2024-01-02T00:00:00Z',
  });
  hubspot.fetchIncremental.mockResolvedValue({
    records: [MOCK_RECORD],
    nextCursor: '2024-01-02T00:00:00Z',
  });
});

describe('syncSource — error isolation', () => {
  it('does not throw when the source API is down', async () => {
    hubspot.fetchFull.mockRejectedValue(new Error('Connection refused'));
    await expect(syncSource('hubspot')).resolves.not.toThrow();
  });

  it('marks the sync_run as failed when source errors', async () => {
    hubspot.fetchFull.mockRejectedValue(new Error('API down'));
    await syncSource('hubspot');

    const finishCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE sync_runs')
    );
    expect(finishCall).toBeDefined();
    expect(finishCall[1][0]).toBe('failed');
  });
});

describe('syncSource — stale cursor fallback', () => {
  it('falls back to full fetch on 410 and clears the cursor', async () => {
    cursor.loadCursor.mockResolvedValue('old-cursor-value');
    const staleError = Object.assign(new Error('410 Gone'), { status: 410 });
    hubspot.fetchIncremental.mockRejectedValue(staleError);
    hubspot.fetchFull.mockResolvedValue({ records: [], nextCursor: 'new-cursor' });

    await syncSource('hubspot');

    expect(cursor.clearCursor).toHaveBeenCalledWith('hubspot');
    expect(hubspot.fetchFull).toHaveBeenCalled();
  });

  it('falls back to full fetch when error message contains "sync token"', async () => {
    cursor.loadCursor.mockResolvedValue('old-cursor');
    hubspot.fetchIncremental.mockRejectedValue(new Error('Invalid sync token'));
    hubspot.fetchFull.mockResolvedValue({ records: [], nextCursor: 'new' });

    await syncSource('hubspot');
    expect(hubspot.fetchFull).toHaveBeenCalled();
  });
});

describe('syncSource — cursor lifecycle', () => {
  it('runs a full fetch when no cursor is stored', async () => {
    cursor.loadCursor.mockResolvedValue(null);
    await syncSource('hubspot');
    expect(hubspot.fetchFull).toHaveBeenCalled();
    expect(hubspot.fetchIncremental).not.toHaveBeenCalled();
  });

  it('saves the new cursor after a successful sync', async () => {
    await syncSource('hubspot');
    expect(cursor.saveCursor).toHaveBeenCalledWith('hubspot', '2024-01-02T00:00:00Z');
  });

  it('uses incremental fetch when a cursor exists', async () => {
    cursor.loadCursor.mockResolvedValue('2024-01-01T00:00:00Z');
    await syncSource('hubspot');
    expect(hubspot.fetchIncremental).toHaveBeenCalledWith('2024-01-01T00:00:00Z');
    expect(hubspot.fetchFull).not.toHaveBeenCalled();
  });
});

describe('syncSource — unknown source', () => {
  it('throws for an unrecognised source name', async () => {
    await expect(syncSource('unknown_source')).rejects.toThrow('Unknown source');
  });
});
