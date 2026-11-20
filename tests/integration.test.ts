import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pool, setActor, transaction } from '../src/db/database.js';
import type { Bid, Scenario, Stats, Task, User, Workload } from '../src/shared.js';

const origin = process.env.TEST_URL ?? 'http://127.0.0.1:3000';
const call = (path: string, user?: number, method = 'GET', body?: object) => fetch(`${origin}/api${path}`, {
  method,
  headers: { ...(user ? { 'X-User-Id': String(user) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const assign = (taskId: number, user: number) => call(`/tasks/${taskId}/assign`, user, 'POST');
const read = async <T>(response: Response, status = 200): Promise<T> => {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body as T;
};
const creator = async () => (await read<User[]>(await call('/users')))[0].id;
const workload = async (id: number) => read<Workload>(await call(`/users/${id}/workload`));
const scenario = async (name: string, owner: number) => read<Scenario>(await call(`/demo/scenarios/${name}`, owner, 'POST'), 201);
after(() => pool.end());

test('two PostgreSQL transactions contend for the same user and only one assigns', async () => {
  const owner = await creator();
  const { taskIds, bidder } = await scenario('race', owner);
  const blocker = await pool.connect();
  let requests: Promise<Response>[] = [];
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [bidder.id]);
    requests = taskIds.map((id) => assign(id, owner));
    const until = Date.now() + 5000;
    let blocked = 0;
    while (Date.now() < until) {
      const { rows: [state] } = await pool.query<{ blocked: number }>(`
        SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%SELECT id FROM users WHERE id IN (%'`);
      blocked = state.blocked;
      if (blocked === 2) break;
      await delay(30);
    }
    assert.equal(blocked, 2, 'both assignment requests should reach the capacity lock');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }

  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const winnerIndex = responses.findIndex((r) => r.ok);
  const loserIndex = 1 - winnerIndex;
  assert.equal((await read<{ code: string }>(responses[loserIndex], 409)).code, 'NO_ELIGIBLE_BIDS');
  const winner = await read<Task>(responses[winnerIndex]);
  assert.equal(winner.assignee_id, bidder.id);
  const expectedHours = winnerIndex === 0 ? 5 : 7;
  assert.deepEqual(await workload(bidder.id), { workload: expectedHours, max_capacity: 10, remaining: 10 - expectedHours });
  assert.equal((await read<Task>(await call(`/tasks/${taskIds[loserIndex]}`))).status, 'bidding_closed');
  assert.equal((await read<Bid[]>(await call(`/tasks/${taskIds[loserIndex]}/bids`)))[0].status, 'pending');
  const { rows: [entry] } = await pool.query(
    `SELECT actor_id, previous_value->>'status' AS before, new_value->>'status' AS after
     FROM audit_log WHERE entity = 'tasks' AND entity_id = $1 AND new_value->>'status' = 'assigned'`, [winner.id],
  );
  assert.deepEqual(entry, { actor_id: owner, before: 'bidding_closed', after: 'assigned' });
});

test('a stale lowest bid is skipped and the higher eligible bid wins', async () => {
  const owner = await creator();
  const { taskIds: [reserve, pending], bidder, fallback } = await scenario('stale', owner);
  await read<Task>(await assign(reserve, owner));
  assert.equal((await workload(bidder.id)).remaining, 2);
  const assigned = await read<Task>(await assign(pending, owner));
  assert.equal(assigned.assignee_id, fallback!.id);
  const bids = await read<Bid[]>(await call(`/tasks/${pending}/bids`));
  assert.deepEqual(bids.map(({ hours, status }) => [hours, status]), [[3, 'not_selected'], [4, 'accepted']]);
});

test('PostgreSQL rejects invalid raw writes even when the API is bypassed', async () => {
  const owner = await creator();
  const { bidder, taskIds: [closed] } = await scenario('race', owner);
  const draft = await read<Task>(await call('/tasks', owner, 'POST', {
    title: 'Validate search result ordering', description: 'Check sort priorities for equal result scores.',
    complexity: 2, deadline: new Date(Date.now() + 100_000).toISOString(),
  }), 201);
  await read<Task>(await call(`/tasks/${draft.id}/status`, owner, 'PATCH', { status: 'open' }));
  const write = (user: number, sql: string, values: number[]) => transaction(async (db) => {
    await setActor(db, user);
    return db.query(sql, values);
  });
  const insertBid = 'INSERT INTO bids(task_id, bidder_id, hours) VALUES ($1, $2, $3)';
  await assert.rejects(write(owner, insertBid, [draft.id, owner, 1]), { message: 'OWN_TASK' });
  await assert.rejects(write(bidder.id, insertBid, [draft.id, bidder.id, 11]), { message: 'CAPACITY_CHANGED' });
  await assert.rejects(write(bidder.id, insertBid, [closed, bidder.id, 1]), { message: 'BIDDING_NOT_OPEN' });
  await assert.rejects(write(owner, "UPDATE tasks SET status = 'draft' WHERE id = $1", [draft.id]), { message: 'INVALID_TASK_TRANSITION' });
  await write(bidder.id, insertBid, [draft.id, bidder.id, 2]);
  await assert.rejects(write(bidder.id, insertBid, [draft.id, bidder.id, 3]), { code: '23505' });
});

test('dashboard returns seeded metrics from a single endpoint', async () => {
  const stats = await read<Stats>(await call('/dashboard/stats'));
  assert.equal(stats.by_status.length, 7);
  assert.equal(stats.average_by_complexity.length, 5);
  assert.ok(stats.top_users.some(({ completed }) => completed > 0));
  assert.ok(stats.overdue_without_bids.some(({ title }) => title === 'Review accessibility labels'));
});
