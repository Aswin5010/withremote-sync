const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Upstash uses rediss:// (TLS); plain redis:// for local
const tlsOptions = redisUrl.startsWith('rediss://') ? { tls: {} } : {};

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...tlsOptions,
});

connection.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

const syncQueue = new Queue('sync', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

/**
 * Enqueue one sync job per source.
 * jobId is keyed by source + minute-bucket so re-triggering within the same
 * minute deduplicates automatically (BullMQ ignores duplicate jobIds).
 */
async function enqueueSyncJobs(sources = ['hubspot', 'google_calendar', 'stripe']) {
  const bucket = Math.floor(Date.now() / 60_000); // minute bucket
  const jobs = sources.map((source) => ({
    name: `sync:${source}`,
    data: { source },
    opts: { jobId: `sync:${source}:${bucket}` },
  }));
  return syncQueue.addBulk(jobs);
}

module.exports = { syncQueue, enqueueSyncJobs, connection };
