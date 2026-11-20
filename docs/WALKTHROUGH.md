# Ten-minute TaskBid walkthrough

Open the live board, a second browser tab, the README, and the SQL and assignment files before recording. Start with a normal browser zoom and a window wide enough to show all seven columns.

## 0:00–1:15 · Introduce the workspace

Show the board and switch between Ava and Daniel. Describe the workflow from posting work to selecting the lowest eligible offer. Point out the seven stages, the bid count and lowest estimate on each card, and how the remaining hours change with the selected user.

## 1:15–3:00 · Place a bid live

As Ava, create a task or open a seeded draft. Open bidding and copy its URL. In the second tab, switch to Daniel and open the task URL. Enter more hours than Daniel has available to show the disabled submit button, then enter a valid amount. Return to Ava’s tab and show the bid listed without a reload. Explain that the database publishes after commit and the browser re-fetches the canonical bid list.

## 3:00–4:55 · Explain the schema

Open `migrations/001_schema.sql`. Explain the task-to-winner foreign key, one bid per user/task, the ranking index, and why the trigger locks task then bidder on insert. Scroll to the workload update and the audit trigger. Describe what gets recorded, using an actual task’s transition as the example. Mention that marking work done releases capacity.

## 4:55–7:15 · Run the assignment race

In the Review lab, run **Capacity race**. The two assignment requests use `Promise.all` with 5 h and 7 h bids against 10 h of capacity. Open the browser Network tab if you want to show the two distinct requests and their HTTP 200 and 409 responses. Show that the losing task stays in Bidding closed and its bid remains pending. Open the assignment handler and point out the ordered user-row locks, the fresh ranking statement, and the final conditional workload update. Mention the integration test that verifies both transactions reach the real PostgreSQL lock before allowing either to proceed.

## 7:15–8:45 · Demonstrate stale bids and the dashboard

Back in the Review lab, run **Stale bid**. Open the second task and show the original 3 h offer alongside the accepted 4 h bid. Open Dashboard and describe the average bid chart, completed-task totals, and overdue work. Briefly show the single dashboard SQL view and explain why the aggregates have separate scopes.

## 8:45–10:00 · Discuss a trade-off and close

Explain one change for more time. For example, add real workspace identities and make the database audit actor come from the authenticated session. Explain what you’re proud of with a concrete example, such as proving both assignment requests overlapped at the database lock while measuring the exact resulting workload. End on the live board and mention the setup and verification commands in the private repository.
