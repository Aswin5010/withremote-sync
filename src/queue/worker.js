require('dotenv').config();
const { Worker } = require('bullmq');
const { connection } = require('./client');

// Lazy-require to avoid circular deps at module load time
function getSyncSource() {
  return require('../pipeline/sync').syncSource;
}

const worker = new Worker(
  'sync',
  async (job) => {
    const { source } = job.data;
    console.log(`[worker] Starting sync job: ${job.id} (source=${source})`);
    await getSyncSource()(source);
    console.log(`[worker] Finished sync job: ${job.id} (source=${source})`);
  },
  {
    connection,
    concurrency: 3, // all 3 sources can process in parallel
    limiter: { max: 10, duration: 60_000 }, // max 10 jobs/min as a safeguard
  }
);

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
});

worker.on('error', (err) => {
  console.error('[worker] Worker error:', err.message);
});

module.exports = worker;
