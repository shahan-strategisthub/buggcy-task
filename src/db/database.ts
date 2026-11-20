import pg from 'pg';
import type { PoolClient } from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (error) => console.error('Idle database connection failed', error.message));

export async function setActor(db: PoolClient, userId: number) {
  await db.query("SELECT set_config('taskbid.actor_id', $1, true)", [String(userId)]);
}

export async function transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError as Error; }
    throw error;
  } finally {
    db.release(releaseError);
  }
}
