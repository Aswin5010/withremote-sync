require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('../src/db/client');

async function migrate() {
  const dir   = path.join(__dirname, '../src/db/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await db.query(sql);
    console.log(`  Done: ${file}`);
  }

  console.log('\nAll migrations complete.');
  await db.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
