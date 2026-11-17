import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || join(here, 'transcript.txt'));
const db = new PGlite();
const lines = [
  'TICKETING SYSTEM - DBMS LEVEL 3 EXECUTION TRANSCRIPT',
  'Engine: PGlite (embedded PostgreSQL); isolated in-memory database',
  'Every SQL statement below was executed. Expected failures prove constraints.',
  '',
];

function format(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function step(label, sql, expectedError) {
  lines.push(`=== ${label} ===`, sql.trim());
  try {
    const results = await db.exec(sql);
    if (expectedError) throw new Error('Expected constraint failure did not occur');
    for (const result of results) {
      lines.push(`OK; rows affected: ${result.affectedRows ?? 0}`);
      if (result.rows?.length) lines.push(format(result.rows));
    }
  } catch (error) {
    if (!expectedError || !String(error.message).includes(expectedError)) throw error;
    lines.push(`EXPECTED ERROR: ${error.message}`);
  }
  lines.push('');
}

try {
  await step('01 Full project DDL generated from Prisma schema', readFileSync(join(here, 'schema.sql'), 'utf8'));
  await step('02 Additional checks, trigger and SQL function', readFileSync(join(here, 'advanced.sql'), 'utf8'));

  await step('03 Seed three users', `
    INSERT INTO users (id,name,email,password_hash,role,department) VALUES
      ('00000000-0000-0000-0000-000000000001','Asha Admin','asha@example.test','demo-hash','Admin','IT Support'),
      ('00000000-0000-0000-0000-000000000002','Evan Editor','evan@example.test','demo-hash','Editor','IT Support'),
      ('00000000-0000-0000-0000-000000000003','Uma User','uma@example.test','demo-hash','User','IT Support');`);
  await step('04 Seed projects, memberships and statuses', `
    INSERT INTO projects (id,name,user_id,department) VALUES
      ('10000000-0000-0000-0000-000000000001','Helpdesk','00000000-0000-0000-0000-000000000001','IT Support'),
      ('10000000-0000-0000-0000-000000000002','Finance','00000000-0000-0000-0000-000000000001','Finance');
    INSERT INTO project_members (project_id,user_id) VALUES
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003');
    INSERT INTO statuses (id,project_id,name,position) VALUES
      ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','To Do',1),
      ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Done',2),
      ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','To Do',1);`);

  await step('05 Show users', 'SELECT id, name, email, role, department FROM users ORDER BY name;');
  await step('06 Show table constraints', `
    SELECT conrelid::regclass AS table_name, conname, contype
    FROM pg_constraint
    WHERE conrelid::regclass::text IN ('users','projects','project_members','statuses','tickets')
    ORDER BY 1, 2;`);
  await step('07 INSERT ticket', `
    INSERT INTO tickets (id,ticket_number,title,priority,project_id,created_by,assigned_to,status_id)
    VALUES ('30000000-0000-0000-0000-000000000001','HELP-0001','Printer is offline','High',
      '10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');`);
  await step('08 SELECT ticket with JOIN', `
    SELECT t.ticket_number,t.title,p.name AS project,s.name AS status,
           creator.name AS creator,assignee.name AS assignee
    FROM tickets t JOIN projects p ON p.id=t.project_id
    JOIN users creator ON creator.id=t.created_by
    LEFT JOIN users assignee ON assignee.id=t.assigned_to
    LEFT JOIN statuses s ON s.id=t.status_id
    ORDER BY t.ticket_number;`);
  await step('09 UPDATE ticket to Done; trigger sets closed_at', `
    UPDATE tickets SET status_id='20000000-0000-0000-0000-000000000002'
    WHERE ticket_number='HELP-0001';
    SELECT ticket_number,closed_at IS NOT NULL AS closed_at_was_set FROM tickets WHERE ticket_number='HELP-0001';`);
  await step('09b Reopen ticket; trigger clears closed_at', `
    UPDATE tickets SET status_id='20000000-0000-0000-0000-000000000001'
    WHERE ticket_number='HELP-0001';
    SELECT ticket_number,closed_at IS NULL AS closed_at_was_cleared FROM tickets WHERE ticket_number='HELP-0001';
    UPDATE tickets SET status_id='20000000-0000-0000-0000-000000000002'
    WHERE ticket_number='HELP-0001';`);
  await step('10 SQL function', `
    SELECT * FROM project_ticket_metrics('10000000-0000-0000-0000-000000000001');`);
  await step('11 Nested correlated query', `
    SELECT u.name FROM users u WHERE EXISTS (
      SELECT 1 FROM tickets t WHERE t.assigned_to=u.id AND t.priority='High'
    ) ORDER BY u.name;`);
  await step('12 CTE with status counts', `
    WITH status_counts AS (
      SELECT s.name,COUNT(t.id) AS ticket_count FROM statuses s
      LEFT JOIN tickets t ON t.status_id=s.id
      WHERE s.project_id='10000000-0000-0000-0000-000000000001'
      GROUP BY s.name
    ) SELECT * FROM status_counts ORDER BY name;`);
  await step('13 UNIQUE constraint rejects duplicate email', `
    INSERT INTO users (name,email,password_hash,role) VALUES ('Duplicate','asha@example.test','x','User');`, 'unique constraint');
  await step('14 CHECK constraint rejects invalid role', `
    INSERT INTO users (name,email,password_hash,role) VALUES ('Invalid','invalid@example.test','x','Owner');`, 'users_role_check');
  await step('15 CHECK constraint rejects invalid priority', `
    UPDATE tickets SET priority='Urgent' WHERE ticket_number='HELP-0001';`, 'tickets_priority_check');
  await step('16 Trigger rejects status from a different project', `
    UPDATE tickets SET status_id='20000000-0000-0000-0000-000000000003'
    WHERE ticket_number='HELP-0001';`, 'status_id must belong');
  await step('17 UNIQUE membership constraint', `
    INSERT INTO project_members (project_id,user_id) VALUES
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');`, 'unique constraint');
  await step('18 FOREIGN KEY rejects missing creator', `
    INSERT INTO tickets (ticket_number,title,project_id,created_by,status_id)
    VALUES ('HELP-0002','Invalid creator','10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001');`, 'foreign key constraint');
  await step('19 DB-level read-only role', `
    CREATE ROLE ticket_demo_reader NOLOGIN;
    GRANT USAGE ON SCHEMA public TO ticket_demo_reader;
    GRANT SELECT ON users, projects, tickets TO ticket_demo_reader;
    SET ROLE ticket_demo_reader;
    SELECT ticket_number,title FROM tickets ORDER BY ticket_number;`);
  await step('20 Read-only role cannot INSERT', `
    INSERT INTO tickets (ticket_number,title,project_id,created_by)
    VALUES ('HELP-0003','Denied','10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001');`, 'permission denied');
  await step('21 Reset role and DELETE ticket', `
    RESET ROLE;
    DELETE FROM tickets WHERE ticket_number='HELP-0001';
    SELECT COUNT(*) AS remaining_tickets FROM tickets;`);
  writeFileSync(output, lines.join('\n'), 'utf8');
  console.log(`Wrote ${output}`);
} catch (error) {
  writeFileSync(output, lines.join('\n') + '\nFAILED: ' + (error.stack || error), 'utf8');
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
