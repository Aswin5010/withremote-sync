require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

// Routes
app.use('/sync',    require('./routes/sync'));
app.use('/metrics', require('./routes/metrics'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  console.error('[app] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start the BullMQ worker in the same process.
// For production scale, run `npm run worker` as a separate Render service.
require('./queue/worker');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
