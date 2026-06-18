const db = require('../db/client');

async function loadCursor(source) {
  const res = await db.query(
    'SELECT cursor FROM sync_cursors WHERE source = $1',
    [source]
  );
  return res.rows[0]?.cursor || null;
}

async function saveCursor(source, cursor) {
  await db.query(
    `INSERT INTO sync_cursors (source, cursor, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (source) DO UPDATE SET cursor = $2, updated_at = now()`,
    [source, cursor]
  );
}

async function clearCursor(source) {
  await db.query('DELETE FROM sync_cursors WHERE source = $1', [source]);
}

module.exports = { loadCursor, saveCursor, clearCursor };
