CREATE VIEW dashboard_stats AS
WITH status_counts AS (
  SELECT status, count(*)::int AS count FROM tasks GROUP BY status
), complexity_averages AS (
  SELECT t.complexity, round(avg(b.hours), 2)::float8 AS average_hours
  FROM tasks t JOIN bids b ON b.task_id = t.id GROUP BY t.complexity
), leaders AS (
  SELECT u.id, u.name, count(*)::int AS completed
  FROM tasks t JOIN bids b ON b.id = t.winning_bid_id JOIN users u ON u.id = b.bidder_id
  WHERE t.status = 'done'
  GROUP BY u.id ORDER BY completed DESC, u.id LIMIT 3
)
SELECT
  (SELECT jsonb_agg(jsonb_build_object('status', s.status, 'count', coalesce(c.count, 0)) ORDER BY s.status)
   FROM unnest(enum_range(NULL::task_status)) s(status) LEFT JOIN status_counts c USING (status)) AS by_status,
  (SELECT jsonb_agg(jsonb_build_object('complexity', s.complexity, 'average_hours', a.average_hours) ORDER BY s.complexity)
   FROM generate_series(1, 5) s(complexity) LEFT JOIN complexity_averages a USING (complexity)) AS average_by_complexity,
  coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.completed DESC, l.id) FROM leaders l), '[]'::jsonb) AS top_users,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'deadline', t.deadline) ORDER BY t.deadline, t.id)
    FROM tasks t WHERE t.deadline < statement_timestamp()
      AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.task_id = t.id)), '[]'::jsonb) AS overdue_without_bids;
