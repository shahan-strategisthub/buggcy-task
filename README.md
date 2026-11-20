# TaskBid

**Live demo** · [taskbid.srv1848938.hstgr.cloud](https://taskbid.srv1848938.hstgr.cloud)

Open the demo in your browser and use the demo user switcher to try the creator and bidder roles. The database contains sample tasks in all seven stages.

TaskBid is a small team workspace for posting tasks, collecting estimates, and assigning work to the lowest eligible bidder. It uses React, Node.js with TypeScript, and PostgreSQL with numbered SQL migrations.

## Run locally

Requires Docker with Compose.

```sh
docker compose up --build --wait
```

Open [localhost:3000](http://localhost:3000). The application applies the migrations and seeds the database on its first startup. Set `TASKBID_PORT` to use another local port. The database is persisted in a named volume and has no published port.

For a native Node.js setup, use Node.js 20.19+ and an empty PostgreSQL database. Set `DATABASE_URL`, run `npm ci` and `npm run db:seed`, then run `npm run build` and `npm start`. For development, run `npm run dev:api` alongside `npm run dev`. Vite proxies API calls to port 3000.

## Try the workflows

1. As Ava Chen, create a draft and open bidding. Copy the task URL from the address bar.
2. Open the workspace in another tab, select Daniel Park, then open the task URL there. Place a bid and watch it appear in Ava’s tab. User selection is stored per tab.
3. As Ava, close bidding and auto-assign the task. The assigned user can start work and send it to review. Ava can mark it done.
4. Open **Review lab** and run **Capacity race**. Two different tasks compete for one bidder with 10 hours and bids of 5 and 7 hours. Exactly one assigns. The other remains closed with its bid pending.
5. Run **Stale bid**. The first assignment leaves Jamie with 2 hours. The second task skips Jamie’s 3-hour bid and selects Taylor’s 4-hour bid.
6. Open **Dashboard** to see totals by status, average bid hours by complexity, the top three completers, and overdue tasks with zero bids.

The Review lab creates a fresh set of tasks and bidders per run so different reviewers can repeat the scenarios independently.

Use **Created by me** and **My bids** to focus the board on the selected demo user. Each card shows who created it and the selected user’s bid when they have one.

## Schema and database constraints

- `users` stores hourly rate, weekly capacity, and a workload counter for the hours committed to active assignments. The counter is bounded by a check constraint. The task transition trigger increments it at assignment and releases those hours at completion in the same transaction as the status change.
- `tasks` retains the creator, deadline, complexity, and winning bid. The enum and transition trigger permit one forward step at a time. The composite foreign key ties a winning bid to its own task, the task trigger requires an accepted bid at assignment, and a partial unique index permits one accepted bid per task.
- `bids` has a unique constraint on `(task_id, bidder_id)` and an index on `(task_id, hours, placed_at, id)` for bid listing and ranking. The database trigger locks the task and bidder rows before rejecting self-bids, bids outside the open stage, and bids exceeding current capacity. The task lock serializes bid placement with closing bidding.
- `audit_log` stores entity IDs, actor IDs, operations, timestamps, and before/after snapshots. The entity index supports reconstructing each task or bid’s history.

The database sees every write and owns the locks needed to evaluate cross-row rules. This keeps invariants in force for direct SQL, imports, and future callers. Triggers introduce implicit work and a lock-order contract. The API sets the audit actor inside each transaction, translates database errors into actionable responses, and consistently locks the task before touching bidder workloads.

## Decisions

### A. Capacity race

`POST /tasks/:id/assign` uses PostgreSQL’s READ COMMITTED isolation. It locks the task, checks that bidding is closed, then locks all pending bidders’ user rows in ascending user-ID order. The next statement ranks bids by hours, timestamp, and ID using the now-current workload. A competing transaction waits on the shared user row and rechecks after the winner commits. In the 5-hour versus 7-hour example, the remaining capacity is either 5 or 3 hours, so the other bid does not fit.

The accepted bid, other bid statuses, task status, workload, and audit records commit together. A conditional workload update inside the task trigger adds a final capacity check. Locking all candidates simplifies deadlock prevention between overlapping assignments. On a much larger board, a carefully ordered approach that locks fewer candidates could reduce contention.

### B. Stale bids

A bid is an offer and does not reserve hours. Assignment skips bidders whose current remaining capacity is below their offer. The original estimates remain visible. On a successful assignment, the winner becomes accepted and other bids become `not_selected`. If every bid is ineligible, the API returns HTTP 409 with `NO_ELIGIBLE_BIDS` and leaves the task and bids untouched. A creator can retry after workload is freed.

### C. Dashboard query

`migrations/002_dashboard.sql` builds four JSON fields in one statement. Grouped aggregates calculate status counts and average hours. A join through the winning bid identifies completers, and `NOT EXISTS` identifies overdue tasks without bids. Each aggregate has its own scope so joining bids cannot multiply task counts. The dashboard includes zero-count stages, and complexity levels without bids return `null` for the average. This approach uses one network round trip and one statement snapshot. The bid rank and deadline indexes support the related lookups as the board grows.

### D. Audit log

Row triggers capture changes in the same transaction as each task or bid write, including changes made by the seed script or direct SQL. The actor ID is transaction-local to keep pooled connections from carrying a previous actor. Audit insert failure aborts the write. PostgreSQL publishes the change notification only after commit. Application middleware would have more request context. A trigger covers write paths outside the web server at the cost of extra database work and more storage for row snapshots.

### Other interpretations

- Hours are positive integers. Weekly capacity is modeled as a rolling ceiling on outstanding work. It has no calendar reset. Drafts, pending bids, and completed tasks consume zero capacity.
- Deadlines are delivery deadlines and flag overdue work. The creator explicitly closes bidding, including on overdue tasks. Equal offers are ranked by earliest timestamp and then bid ID.
- The creator opens and closes bidding, assigns, and marks reviewed work done. The assignee starts work and sends it to review. The demo identity is supplied via `X-User-Id`. Real deployment would use authenticated identities and per-workspace authorization.
- The HTTPS demo is directly accessible. Visitors share the seeded workspace and can act as any demo user through the switcher.
- Live updates use Server-Sent Events because only the server pushes events. One PostgreSQL `LISTEN` connection per process receives commit notifications and invalidates browser snapshots. Clients re-fetch authoritative data when connecting, after changes, and every 30 seconds as a fallback. This avoids a replay store while limiting the effect of missed notifications during a reconnect.

## API

The REST endpoints also accept the `/api` prefix used by the frontend. Write requests identify the actor using `X-User-Id`.

- `GET /tasks` (optional `?viewer=<id>` for the selected user's bid), `GET /tasks/:id`, `POST /tasks`
- `PATCH /tasks/:id/status` with `{"status":"open"}` (or the applicable next stage)
- `GET /tasks/:id/bids`, `POST /tasks/:id/bids` with `{"hours":5}`
- `POST /tasks/:id/assign`
- `GET /users`, `GET /users/:id/workload`, `GET /dashboard/stats`
- `GET /events`, `GET /health`, `POST /demo/scenarios/race`, `POST /demo/scenarios/stale`

## Verify

Run the tests against a local demo database. They create fixture data.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

For the integration suite, provide `DATABASE_URL` for the same database the API serves. With the default Compose stack, the following runs the suite in an isolated Node container on the Compose network:

```sh
docker run --rm --network taskbid_default \
  --mount "type=bind,source=$PWD,target=/workspace" \
  -w /workspace -e TEST_URL=http://app:3000 \
  -e DATABASE_URL=postgresql://taskbid:taskbid-local@db:5432/taskbid \
  node:22-alpine npm run test:integration
```

The race integration test holds the competing bidder’s row lock until PostgreSQL reports both API transactions waiting, then asserts one winner, exact workload, unchanged losing bid, and an audit record. The browser tests cover task creation and delivery, bid validation and SSE across tabs, stale capacity recovery, the dashboard, and both review scenarios on a mobile viewport.
