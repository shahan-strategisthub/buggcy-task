import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { setActor } from './db/database.js';
import type { Scenario, User } from './shared.js';

async function createBidder(db: PoolClient, name: string, capacity: number): Promise<User> {
  const result = await db.query<User>(
    `INSERT INTO users(name, email, hourly_rate, max_capacity, is_scenario_user)
     VALUES ($1, $2, 75, $3, true) RETURNING id, name`,
    [name, `${randomUUID()}@example.test`, capacity],
  );
  return result.rows[0];
}

async function createAuction(
  db: PoolClient, creator: User, title: string, description: string, bids: [User, number][],
) {
  await setActor(db, creator.id);
  const { rows: [{ id }] } = await db.query<{ id: number }>(
    `INSERT INTO tasks (title, description, complexity, deadline, creator_id)
     VALUES ($1, $2, 3, now() + interval '3 days', $3) RETURNING id`,
    [title, description, creator.id],
  );
  await db.query("UPDATE tasks SET status = 'open' WHERE id = $1", [id]);
  for (const [bidder, hours] of bids) {
    await setActor(db, bidder.id);
    await db.query('INSERT INTO bids(task_id, bidder_id, hours) VALUES ($1, $2, $3)', [id, bidder.id, hours]);
  }
  await setActor(db, creator.id);
  await db.query("UPDATE tasks SET status = 'bidding_closed' WHERE id = $1", [id]);
  return id;
}

export async function createScenario(db: PoolClient, creator: User, name: 'race' | 'stale'): Promise<Scenario> {
  const run = randomUUID().slice(0, 5);
  if (name === 'race') {
    const bidder = await createBidder(db, `Alex Morgan (race ${run})`, 10);
    const taskIds = [
      await createAuction(db, creator, `Race ${run} · Task X`, 'Alex offered 5 h and has 10 h of total capacity. Assign Task X and Task Y concurrently.', [[bidder, 5]]),
      await createAuction(db, creator, `Race ${run} · Task Y`, 'Alex offered 7 h and has 10 h of total capacity. Together, the two bids would require 12 h.', [[bidder, 7]]),
    ];
    return { taskIds, creator, bidder, remaining: 10 };
  }

  const bidder = await createBidder(db, `Jamie Lee (stale ${run})`, 15);
  const fallback = await createBidder(db, `Taylor Kim (stale ${run})`, 15);
  const taskIds = [
    await createAuction(db, creator, `Stale ${run} · Reserve work`, 'Assign this first to use 13 of Jamie’s 15 hours.', [[bidder, 13]]),
    await createAuction(db, creator, `Stale ${run} · Choose a bidder`, 'Assign this second. Jamie offered 3 h, but after the first assignment only has 2 h left. Taylor offered 4 h.', [[bidder, 3], [fallback, 4]]),
  ];
  return { taskIds, creator, bidder, fallback, remaining: 15 };
}
