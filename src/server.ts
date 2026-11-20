import express, { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { resolve } from 'node:path';
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import { pool, setActor, transaction } from './db/database.js';
import { createScenario } from './demo.js';
import { statusLabels, statuses } from './shared.js';
import type { Bid, Stats, Task, User, Workload } from './shared.js';

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const dbErrors: Record<string, [number, string]> = {
  TASK_NOT_FOUND: [404, 'This task could not be found.'],
  USER_NOT_FOUND: [404, 'This demo user could not be found.'],
  OWN_TASK: [403, 'You cannot bid on a task you created.'],
  BIDDING_NOT_OPEN: [409, 'This task is no longer accepting bids.'],
  CAPACITY_CHANGED: [409, 'This bid exceeds your current remaining capacity. Review your available hours and try again.'],
  INVALID_TASK_TRANSITION: [409, 'This task has moved to a different stage. Refresh its details and try again.'],
};

function id(value: unknown, label: string) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2147483647) {
    throw new HttpError(400, 'INVALID_ID', `Provide a valid ${label}.`);
  }
  return parsed;
}

function taskId(req: Request) { return id(req.params.id, 'task ID'); }

function requireOwner(task: Task, user: User) {
  if (task.creator_id !== user.id) throw new HttpError(403, 'CREATOR_REQUIRED', 'Only the task creator can take this action.');
}

const taskQuery = `
  SELECT t.id, t.title, t.description, t.complexity, t.status, t.deadline, t.creator_id,
         creator.name AS creator_name, assigned.id AS assignee_id, assigned.name AS assignee_name,
         totals.bid_count, totals.lowest_bid
  FROM tasks t
  JOIN users creator ON creator.id = t.creator_id
  LEFT JOIN bids winner ON winner.id = t.winning_bid_id
  LEFT JOIN users assigned ON assigned.id = winner.bidder_id
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS bid_count, min(hours) AS lowest_bid FROM bids WHERE task_id = t.id
  ) totals`;

async function getTask(db: Pool | PoolClient, value: number, lock = false): Promise<Task> {
  if (lock) await db.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [value]);
  const result = await db.query<Task>(`${taskQuery} WHERE t.id = $1`, [value]);
  if (!result.rows[0]) throw new HttpError(404, 'TASK_NOT_FOUND', 'This task could not be found.');
  return result.rows[0];
}

async function getWorkload(value: number) {
  const { rows: [workload] } = await pool.query<Workload>(
    'SELECT workload, max_capacity, max_capacity - workload AS remaining FROM users WHERE id = $1', [value],
  );
  if (!workload) throw new HttpError(404, 'USER_NOT_FOUND', 'This demo user could not be found.');
  return workload;
}

function mutate(action: (db: PoolClient, req: Request, user: User) => Promise<unknown>, status = 200): RequestHandler {
  return async (req, res) => {
    const userId = id(req.get('X-User-Id'), 'demo user in the X-User-Id header');
    const result = await transaction(async (db) => {
      const { rows: [user] } = await db.query<User>('SELECT id, name FROM users WHERE id = $1', [userId]);
      if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'This demo user could not be found.');
      await setActor(db, userId);
      return action(db, req, user);
    });
    res.status(status).json(result);
  };
}

const api = Router();
api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});
api.get('/users', async (_req, res) => {
  const result = await pool.query<User>('SELECT id, name FROM users ORDER BY is_scenario_user, id');
  res.json(result.rows);
});
api.get('/users/:id/workload', async (req, res) => { res.json(await getWorkload(id(req.params.id, 'user ID'))); });
api.get('/tasks', async (_req, res) => {
  const result = await pool.query<Task>(`${taskQuery} ORDER BY t.created_at DESC, t.id DESC`);
  res.json(result.rows);
});
api.get('/tasks/:id', async (req, res) => { res.json(await getTask(pool, taskId(req))); });
api.post('/tasks', mutate(async (db, req, user) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const { complexity, deadline } = req.body ?? {};
  const deadlineTime = typeof deadline === 'string' && /T.+(?:Z|[+-]\d{2}:\d{2})$/.test(deadline) ? Date.parse(deadline) : NaN;
  if (!title || title.length > 120 || !description || description.length > 3000 ||
      !Number.isInteger(complexity) || complexity < 1 || complexity > 5 || !Number.isFinite(deadlineTime)) {
    throw new HttpError(400, 'INVALID_TASK', 'Enter a title (up to 120 characters), description (up to 3,000), complexity from 1 to 5, and a valid deadline with a time zone.');
  }
  const { rows: [{ id: createdId }] } = await db.query<{ id: number }>(
    'INSERT INTO tasks (title, description, complexity, deadline, creator_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [title, description, complexity, new Date(deadlineTime).toISOString(), user.id],
  );
  return getTask(db, createdId);
}, 201));

api.patch('/tasks/:id/status', mutate(async (db, req, user) => {
  const task = await getTask(db, taskId(req), true);
  const next = statuses[statuses.indexOf(task.status) + 1];
  if (!next || next === 'assigned' || req.body?.status !== next) {
    throw new HttpError(409, 'INVALID_TASK_TRANSITION', task.status === 'bidding_closed'
      ? 'Use auto-assign to select a bidder for this task.'
      : `This task is currently in ${statusLabels[task.status].toLowerCase()}. Only the next stage is allowed.`);
  }
  if (task.status === 'assigned' || task.status === 'in_progress') {
    if (task.assignee_id !== user.id) throw new HttpError(403, 'ASSIGNEE_REQUIRED', 'Only the assigned teammate can take this action.');
  } else {
    requireOwner(task, user);
  }
  await db.query('UPDATE tasks SET status = $2 WHERE id = $1', [task.id, next]);
  return getTask(db, task.id);
}));

api.get('/tasks/:id/bids', async (req, res) => {
  const value = taskId(req);
  await getTask(pool, value);
  const result = await pool.query<Bid>(
    `SELECT b.id, b.bidder_id, u.name AS bidder_name, b.hours, b.placed_at, b.status
     FROM bids b JOIN users u ON u.id = b.bidder_id
     WHERE b.task_id = $1 ORDER BY b.hours, b.placed_at, b.id`, [value],
  );
  res.json(result.rows);
});

api.post('/tasks/:id/bids', mutate(async (db, req, user) => {
  const hours = req.body?.hours;
  if (!Number.isInteger(hours) || hours < 1 || hours > 2147483647) {
    throw new HttpError(400, 'INVALID_HOURS', 'Enter a positive, whole number of hours.');
  }
  const { rows: [bid] } = await db.query<Bid>(
    `INSERT INTO bids(task_id, bidder_id, hours) VALUES ($1, $2, $3)
     RETURNING id, bidder_id, $4::text AS bidder_name, hours, placed_at, status`,
    [taskId(req), user.id, hours, user.name],
  );
  return bid;
}, 201));

api.post('/tasks/:id/assign', mutate(async (db, req, user) => {
  const task = await getTask(db, taskId(req), true);
  requireOwner(task, user);
  if (task.status !== 'bidding_closed') {
    throw new HttpError(409, 'BIDDING_NOT_CLOSED', 'Only a task with closed bidding can be assigned.');
  }

  // Lock distinct candidate users in the same order across different tasks.
  await db.query(`
    SELECT id FROM users WHERE id IN (
      SELECT bidder_id FROM bids WHERE task_id = $1 AND status = 'pending'
    ) ORDER BY id FOR UPDATE`, [task.id]);

  // Under READ COMMITTED this statement sees any workload committed while waiting above.
  const { rows: [winner] } = await db.query<{ id: number }>(`
    SELECT b.id FROM bids b JOIN users u ON u.id = b.bidder_id
    WHERE b.task_id = $1 AND b.status = 'pending' AND b.hours <= u.max_capacity - u.workload
    ORDER BY b.hours, b.placed_at, b.id LIMIT 1`, [task.id]);
  if (!winner) throw new HttpError(409, 'NO_ELIGIBLE_BIDS', 'No bidder currently has enough capacity to take this task.');

  await db.query(`
    UPDATE bids SET status = CASE WHEN id = $2 THEN 'accepted'::bid_status ELSE 'not_selected'::bid_status END
    WHERE task_id = $1 AND status = 'pending'`, [task.id, winner.id]);
  await db.query("UPDATE tasks SET status = 'assigned', winning_bid_id = $2 WHERE id = $1", [task.id, winner.id]);
  return getTask(db, task.id);
}));

api.get('/dashboard/stats', async (_req, res) => {
  const { rows: [stats] } = await pool.query<Stats>('SELECT * FROM dashboard_stats');
  res.json(stats);
});
api.post('/demo/scenarios/:name', mutate(async (db, req, user) => {
  const name = req.params.name;
  if (name !== 'race' && name !== 'stale') throw new HttpError(404, 'UNKNOWN_SCENARIO', 'This review scenario does not exist.');
  return createScenario(db, user, name);
}, 201));

const streams = new Set<Response>();
function broadcast(payload: string) {
  for (const stream of streams) stream.write(`data: ${payload}\n\n`);
}
api.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 2000\ndata: {}\n\n');
  streams.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  res.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
  req.socket.setKeepAlive(true);
});

let stopping = false;
let listener: pg.Client | undefined;
async function listenForChanges() {
  while (!stopping) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    listener = client;
    const disconnected = new Promise<void>((finish) => {
      client.on('error', (error) => { console.error('Live updates disconnected', error.message); finish(); });
      client.once('end', finish);
    });
    try {
      await client.connect();
      await client.query('LISTEN taskbid_changes');
      client.on('notification', ({ payload }) => { if (payload) broadcast(payload); });
      broadcast('{}');
      await disconnected;
    } catch (error) {
      console.error('Could not subscribe to live updates', (error as Error).message);
    } finally {
      await client.end().catch(() => undefined);
    }
    if (!stopping) await new Promise((finish) => setTimeout(finish, 2000));
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12kb' }));
app.use('/api', api, (_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'This endpoint does not exist.' }));
app.use(api);
app.use(express.static(resolve('dist/web')));
app.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) return res.status(error.status).json({ code: error.code, message: error.message });
  const { code, message, type, constraint } = error as { code?: string; message?: string; type?: string; constraint?: string };
  if (code === '23505' && constraint === 'bids_task_id_bidder_id_key') {
    return res.status(409).json({ code: 'DUPLICATE_BID', message: 'You have already bid on this task.' });
  }
  const known = message && Object.hasOwn(dbErrors, message) ? dbErrors[message] : undefined;
  if (known) return res.status(known[0]).json({ code: message, message: known[1] });
  if (type === 'entity.parse.failed' || type === 'entity.too.large') {
    return res.status(400).json({ code: 'INVALID_BODY', message: 'Send a valid JSON request of at most 12 KB.' });
  }
  console.error(error);
  return res.status(500).json({ code: 'SERVER_ERROR', message: 'TaskBid could not complete this request. Try again in a moment.' });
});

const server = app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0', () => {
  console.log(`TaskBid listening on port ${process.env.PORT ?? 3000}`);
});
void listenForChanges();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const stream of streams) stream.end();
  await listener?.end().catch(() => undefined);
  server.close(() => { void pool.end(); });
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
