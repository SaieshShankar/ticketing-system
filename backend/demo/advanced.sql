-- Apply once after `npx prisma db push` on a real PostgreSQL database.
-- The demo runner applies it to a fresh embedded PostgreSQL instance.

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SuperAdmin', 'Admin', 'Editor', 'User'));

ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check
  CHECK (priority IS NULL OR priority IN ('Low', 'Medium', 'High', 'Critical'));

-- Viva modification: a ticket can only use a status from its own project.
-- Moving it to/from Done automatically maintains the closed timestamp.
CREATE OR REPLACE FUNCTION guard_ticket_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  status_project uuid;
  status_name text;
BEGIN
  IF NEW.status_id IS NULL THEN
    IF TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
      NEW.closed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT project_id, name INTO status_project, status_name
  FROM statuses WHERE id = NEW.status_id;

  IF status_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'status_id must belong to the ticket project'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    IF status_name = 'Done' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, CURRENT_TIMESTAMP);
    ELSE
      NEW.closed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ticket_status_guard
BEFORE INSERT OR UPDATE OF status_id, project_id ON tickets
FOR EACH ROW EXECUTE FUNCTION guard_ticket_status();

-- Reusable reporting function for the evaluation.
CREATE OR REPLACE FUNCTION project_ticket_metrics(p_project_id uuid)
RETURNS TABLE(total bigint, open_count bigint, done_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT count(*),
         count(*) FILTER (WHERE s.name IS DISTINCT FROM 'Done'),
         count(*) FILTER (WHERE s.name = 'Done')
  FROM tickets t
  LEFT JOIN statuses s ON s.id = t.status_id
  WHERE t.project_id = p_project_id;
$$;
