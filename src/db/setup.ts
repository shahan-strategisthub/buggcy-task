import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool, transaction } from './database.js';

try {
  const names = (await readdir('migrations')).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  if (process.argv.includes('--seed')) names.push('../seed.sql');

  for (const name of names) {
    const sql = await readFile(resolve('migrations', name), 'utf8');
    await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(32051480)');
      await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const applied = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (applied.rowCount) return;
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      console.log(`Applied ${name}`);
    });
  }
} finally {
  await pool.end();
}
