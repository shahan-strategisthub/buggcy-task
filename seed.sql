DO $$
DECLARE
  ava integer;
  daniel integer;
  maya integer;
  sofia integer;
  task_id integer;
  bid_id integer;
  demo record;
BEGIN
  INSERT INTO users(name, email, hourly_rate, max_capacity)
    VALUES ('Ava Chen', 'ava@example.test', 85, 40) RETURNING id INTO ava;
  INSERT INTO users(name, email, hourly_rate, max_capacity)
    VALUES ('Daniel Park', 'daniel@example.test', 75, 24) RETURNING id INTO daniel;
  INSERT INTO users(name, email, hourly_rate, max_capacity)
    VALUES ('Maya Patel', 'maya@example.test', 80, 32) RETURNING id INTO maya;
  INSERT INTO users(name, email, hourly_rate, max_capacity)
    VALUES ('Sofia Rivera', 'sofia@example.test', 70, 16) RETURNING id INTO sofia;

  FOR demo IN SELECT * FROM (VALUES
    ('Define the export format', 'Write a short proposal for which fields go into the CSV and how dates are represented.', 2, 'draft', 12, NULL, NULL),
    ('Clean up onboarding copy', 'Review the welcome screen, account setup steps, and empty states. Publish a revised copy doc.', 2, 'draft', 10, NULL, NULL),
    ('Improve search filters', 'Add a saved filter for priority and owner. Cover keyboard navigation and the empty-results state.', 4, 'open', 4, daniel, 8),
    ('Fix mobile navigation', 'Resolve the layout shift when the main menu opens on a narrow viewport.', 3, 'open', 2, NULL, NULL),
    ('Review accessibility labels', 'Audit interactive controls in the settings page and fix missing labels and announcements.', 2, 'open', -1, NULL, NULL),
    ('Build activity feed', 'Show recent workspace changes with an actor, a timestamp, and a link to the affected item.', 5, 'bidding_closed', 6, maya, 10),
    ('Add CSV export', 'Export the current filtered results and use consistent headers and date formats.', 3, 'assigned', 7, daniel, 6),
    ('Refactor email templates', 'Extract shared layouts and verify the account, invite, and update emails.', 4, 'in_progress', 5, maya, 8),
    ('Update API documentation', 'Document the task endpoint, including real request examples and common error responses.', 2, 'review', 3, sofia, 3),
    ('Set up error tracking', 'Add server-side error reporting and verify events arrive with environment context.', 3, 'done', -3, daniel, 5),
    ('Publish component guide', 'Document buttons, form fields, and dialogs with usage and accessibility examples.', 2, 'done', -5, maya, 4),
    ('Automate release notes', 'Generate a release draft from merged changes and share it with the team.', 4, 'done', -7, daniel, 9)
  ) AS samples(title, description, complexity, target, days, bidder, hours)
  LOOP
    PERFORM set_config('taskbid.actor_id', ava::text, true);
    INSERT INTO tasks(title, description, complexity, deadline, creator_id)
      VALUES (demo.title, demo.description, demo.complexity, now() + make_interval(days => demo.days), ava)
      RETURNING id INTO task_id;
    IF demo.target = 'draft' THEN CONTINUE; END IF;
    UPDATE tasks SET status = 'open' WHERE id = task_id;
    IF demo.bidder IS NOT NULL THEN
      PERFORM set_config('taskbid.actor_id', demo.bidder::text, true);
      INSERT INTO bids(task_id, bidder_id, hours) VALUES (task_id, demo.bidder, demo.hours) RETURNING id INTO bid_id;
      IF demo.title = 'Build activity feed' THEN
        PERFORM set_config('taskbid.actor_id', sofia::text, true);
        INSERT INTO bids(task_id, bidder_id, hours) VALUES (task_id, sofia, 12);
      END IF;
    END IF;
    PERFORM set_config('taskbid.actor_id', ava::text, true);
    IF demo.target = 'open' THEN CONTINUE; END IF;
    UPDATE tasks SET status = 'bidding_closed' WHERE id = task_id;
    IF demo.target = 'bidding_closed' THEN CONTINUE; END IF;
    UPDATE bids SET status = 'accepted' WHERE id = bid_id;
    UPDATE tasks SET status = 'assigned', winning_bid_id = bid_id WHERE id = task_id;
    IF demo.target = 'assigned' THEN CONTINUE; END IF;
    PERFORM set_config('taskbid.actor_id', demo.bidder::text, true);
    UPDATE tasks SET status = 'in_progress' WHERE id = task_id;
    IF demo.target = 'in_progress' THEN CONTINUE; END IF;
    UPDATE tasks SET status = 'review' WHERE id = task_id;
    IF demo.target = 'review' THEN CONTINUE; END IF;
    PERFORM set_config('taskbid.actor_id', ava::text, true);
    UPDATE tasks SET status = 'done' WHERE id = task_id;
  END LOOP;
END $$;
