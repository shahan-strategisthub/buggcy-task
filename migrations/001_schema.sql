CREATE TYPE task_status AS ENUM ('draft', 'open', 'bidding_closed', 'assigned', 'in_progress', 'review', 'done');
CREATE TYPE bid_status AS ENUM ('pending', 'accepted', 'not_selected');

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  email text NOT NULL UNIQUE,
  hourly_rate numeric(8, 2) NOT NULL CHECK (hourly_rate >= 0),
  max_capacity integer NOT NULL CHECK (max_capacity > 0),
  workload integer NOT NULL DEFAULT 0 CHECK (workload BETWEEN 0 AND max_capacity),
  is_scenario_user boolean NOT NULL DEFAULT false
);

CREATE TABLE tasks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 3000),
  complexity smallint NOT NULL CHECK (complexity BETWEEN 1 AND 5),
  status task_status NOT NULL DEFAULT 'draft',
  deadline timestamptz NOT NULL,
  creator_id integer NOT NULL REFERENCES users(id),
  winning_bid_id integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status >= 'assigned') = (winning_bid_id IS NOT NULL))
);

CREATE TABLE bids (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id integer NOT NULL REFERENCES tasks(id),
  bidder_id integer NOT NULL REFERENCES users(id),
  hours integer NOT NULL CHECK (hours > 0),
  placed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status bid_status NOT NULL DEFAULT 'pending',
  UNIQUE (task_id, bidder_id),
  UNIQUE (task_id, id)
);

ALTER TABLE tasks ADD CONSTRAINT task_winning_bid_fk
  FOREIGN KEY (id, winning_bid_id) REFERENCES bids(task_id, id);
CREATE UNIQUE INDEX bids_one_accepted ON bids(task_id) WHERE status = 'accepted';
CREATE INDEX bids_rank ON bids(task_id, hours, placed_at, id);
CREATE INDEX tasks_deadline ON tasks(deadline);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('tasks', 'bids')),
  entity_id integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id integer NOT NULL REFERENCES users(id),
  happened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  previous_value jsonb,
  new_value jsonb
);
CREATE INDEX audit_entity ON audit_log(entity, entity_id, id);

CREATE FUNCTION guard_bid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  task_row tasks%ROWTYPE;
  bidder users%ROWTYPE;
BEGIN
  SELECT * INTO task_row FROM tasks WHERE id = NEW.task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TASK_NOT_FOUND';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.task_id, NEW.bidder_id, NEW.hours, NEW.placed_at)
         IS DISTINCT FROM ROW(OLD.id, OLD.task_id, OLD.bidder_id, OLD.hours, OLD.placed_at)
       OR OLD.status <> 'pending' OR NEW.status = 'pending' OR task_row.status <> 'bidding_closed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_BID_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending' OR task_row.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BIDDING_NOT_OPEN';
  END IF;
  IF task_row.creator_id = NEW.bidder_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OWN_TASK';
  END IF;
  SELECT * INTO bidder FROM users WHERE id = NEW.bidder_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USER_NOT_FOUND';
  END IF;
  IF NEW.hours > bidder.max_capacity - bidder.workload THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CAPACITY_CHANGED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_bid BEFORE INSERT OR UPDATE ON bids FOR EACH ROW EXECUTE FUNCTION guard_bid();

CREATE FUNCTION guard_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  winning_bid bids%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TASK_TRANSITION';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.creator_id <> OLD.creator_id
     OR (OLD.winning_bid_id IS NOT NULL AND NEW.winning_bid_id IS DISTINCT FROM OLD.winning_bid_id)
     OR (NEW.status <> OLD.status AND NEW.status IS DISTINCT FROM
         (enum_range(NULL::task_status))[array_position(enum_range(NULL::task_status), OLD.status) + 1]) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_TASK_TRANSITION';
  END IF;

  IF NEW.status <> OLD.status AND NEW.status IN ('assigned', 'done') THEN
    SELECT * INTO winning_bid FROM bids WHERE id = NEW.winning_bid_id AND task_id = NEW.id AND status = 'accepted';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_WINNING_BID';
    END IF;

    IF NEW.status = 'assigned' THEN
      UPDATE users SET workload = workload + winning_bid.hours
        WHERE id = winning_bid.bidder_id AND workload <= max_capacity - winning_bid.hours;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CAPACITY_CHANGED';
      END IF;
    ELSE
      UPDATE users SET workload = workload - winning_bid.hours WHERE id = winning_bid.bidder_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_task BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_task();

CREATE FUNCTION record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_row jsonb;
  new_row jsonb;
  changed_id integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF previous_row = new_row THEN RETURN NULL; END IF;

  changed_id := COALESCE(NEW.id, OLD.id);
  INSERT INTO audit_log (entity, entity_id, operation, actor_id, previous_value, new_value)
    VALUES (TG_TABLE_NAME, changed_id, TG_OP,
            NULLIF(current_setting('taskbid.actor_id', true), '')::integer, previous_row, new_row);
  -- PostgreSQL emits this only if the transaction commits, including for changes outside the API.
  PERFORM pg_notify('taskbid_changes', json_build_object(
    'taskId', CASE WHEN TG_TABLE_NAME = 'tasks' THEN changed_id
                   ELSE (COALESCE(new_row, previous_row)->>'task_id')::integer END
  )::text);
  RETURN NULL;
END;
$$;
CREATE TRIGGER audit_tasks AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TRIGGER audit_bids AFTER INSERT OR UPDATE OR DELETE ON bids FOR EACH ROW EXECUTE FUNCTION record_change();
