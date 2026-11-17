# DBMS Level 3 evaluation runbook: ticketing system

Use PowerShell in the repository root unless a section says otherwise. Open this file or the exported `.txt` copy in Notepad during the demonstration. Run commands in the order shown. The SQL transcript is from an isolated embedded PostgreSQL database and has already been executed; the live commands below require your PostgreSQL, Redis, and Supabase credentials.

## 1. Prepare the live application

Install PostgreSQL and Redis, create an empty PostgreSQL database named `ticketing`, and create a Supabase storage bucket named `attachments` if demonstrating file upload. Put your real connection details into the example environment files. Do not commit the populated `.env` files.

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
npm ci
npx prisma validate
npx prisma generate
npx prisma db push
psql $env:DIRECT_URL -v ON_ERROR_STOP=1 -f demo/advanced.sql
```

If `DIRECT_URL` is only set in `.env`, run `psql` with the actual URL or set `$env:DIRECT_URL` in this PowerShell session. `prisma db push` creates the ten tables and their primary, foreign, and unique keys; `advanced.sql` adds CHECK constraints, a trigger, and a function. Apply `advanced.sql` once to a fresh database. On an existing database, review current role and priority values first because a CHECK constraint rejects invalid existing rows.

Start the backend in this terminal:

```powershell
npm run dev
```

In a second terminal:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3001`. Verify the backend at `http://localhost:3000/api/health`. The backend needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to start even if the storage demonstration is skipped. For Redis on Windows, use a working Redis-compatible server or a remote Redis URL in `backend/.env`.

## 2. Database design and creation (rubric items 1–5)

Open `docs/ER_AND_RELATIONAL_SCHEMA.md` for the ER diagram and the table-by-table relational schema. Show `backend/prisma/schema.prisma`, `backend/demo/schema.sql`, and `backend/demo/advanced.sql`.

```powershell
cd backend
notepad ..\docs\ER_AND_RELATIONAL_SCHEMA.md
notepad demo\schema.sql
notepad demo\advanced.sql
psql $env:DIRECT_URL -c "\dt"
psql $env:DIRECT_URL -c "\d users"
psql $env:DIRECT_URL -c "\d tickets"
psql $env:DIRECT_URL -c "SELECT conrelid::regclass AS table_name, conname, contype FROM pg_constraint WHERE conrelid::regclass::text IN ('users','tickets','project_members','statuses') ORDER BY 1,2;"
```

Technology justification: PostgreSQL provides joins, foreign keys, transactions, functions, and triggers for the core ticketing data. Prisma gives the Express backend typed data access. Redis stores short-lived dashboard and project summary documents with a 300-second TTL; ticket and membership writes invalidate the affected keys. The Next.js app calls the Express API, which reads and writes PostgreSQL through Prisma.

## 3. Execute every SQL rubric command safely (items 6–8, 12)

This command creates a fresh, in-memory PostgreSQL instance, runs the complete DDL, seeds demo data, and executes all listed statements. It needs no production credentials. The output includes SQL, returned rows, and expected constraint failures.

```powershell
cd backend
node demo/run-demo.mjs demo/transcript.txt
notepad demo/transcript.txt
```

Show these sections in the transcript:

| Section | Rubric evidence |
|---|---|
| 01–02 | Full SQL DDL; keys; CHECK constraints; trigger and SQL function |
| 03–06 | Seed data, show users, inspect constraints |
| 07–09, 21 | INSERT, SELECT, UPDATE, DELETE |
| 08, 11–12 | Multi-table JOIN, correlated subquery, CTE |
| 10 | `project_ticket_metrics()` function |
| 09, 16 | Trigger fills `closed_at` and rejects cross-project status |
| 13–18 | UNIQUE, CHECK, and FOREIGN KEY failures |
| 19–20 | Database read-only role: SELECT allowed, INSERT denied |

For a live PostgreSQL database, run each SQL statement from `demo/transcript.txt` individually in pgAdmin or `psql`; avoid running the seed and DELETE statements on a shared database. The transcript's demo IDs use the `.test` email domain and fixed UUIDs.

## 4. NoSQL/Redis creation and RUD (rubric items 4 and 9)

With Redis running, the following commands create, read, update, and delete a JSON document. The `summary:*` and `dashboard:*` keys correspond to the project's actual cache pattern in `backend/src/lib/cache.ts`.

```powershell
cd backend
node demo/redis-demo.mjs
redis-cli SET dbms-demo:ticket:HELP-0001 '{"title":"Printer is offline","priority":"High"}'
redis-cli GET dbms-demo:ticket:HELP-0001
redis-cli SET dbms-demo:ticket:HELP-0001 '{"title":"Printer is offline","priority":"Critical"}'
redis-cli GET dbms-demo:ticket:HELP-0001
redis-cli DEL dbms-demo:ticket:HELP-0001
redis-cli EXISTS dbms-demo:ticket:HELP-0001
redis-cli SET dbms-demo:summary:helpdesk '{"total":1,"open":1}' EX 60
redis-cli TTL dbms-demo:summary:helpdesk
redis-cli DEL dbms-demo:summary:helpdesk
```

`redis-demo.mjs` reads `REDIS_URL`; plain `redis-cli` defaults to localhost port 6379. The Redis keys are temporary documents and caches, not a replacement for the relational ticket records. Do not run `FLUSHALL` on a shared Redis server.

## 5. API, authentication, roles, and web interface (items 10–12)

Run these in a new PowerShell terminal after both services and PostgreSQL are running. Public signup always creates a `User`, even if a caller submits `role = Admin`. Bootstrap one demonstration Admin with direct SQL, then log in again to obtain an Admin JWT. Use a throwaway demo database and password.

```powershell
$base = 'http://localhost:3000/api'
$signup = @{ name='Asha Admin'; email='asha@example.test'; password='DemoPass#123'; role='Admin'; department='IT Support' } | ConvertTo-Json
$newUser = Invoke-RestMethod -Method Post -Uri "$base/auth/signup" -ContentType 'application/json' -Body $signup
$newUser.user | Select-Object name,email,role
psql $env:DIRECT_URL -c "UPDATE users SET role='Admin' WHERE email='asha@example.test';"
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ email='asha@example.test'; password='DemoPass#123' } | ConvertTo-Json)
$admin = @{ 'x-auth-token' = $login.accessToken }
Invoke-RestMethod -Uri "$base/users" -Headers $admin | Select-Object total,users
$project = Invoke-RestMethod -Method Post -Uri "$base/project" -Headers $admin -ContentType 'application/json' -Body (@{ name='Helpdesk Demo'; department='IT Support'; description='DBMS evaluation' } | ConvertTo-Json)
$projectId = $project.project.id
$todo = Invoke-RestMethod -Method Post -Uri "$base/project/$projectId/statuses" -Headers $admin -ContentType 'application/json' -Body (@{ name='To Do'; position=1 } | ConvertTo-Json)
$done = Invoke-RestMethod -Method Post -Uri "$base/project/$projectId/statuses" -Headers $admin -ContentType 'application/json' -Body (@{ name='Done'; position=2 } | ConvertTo-Json)
$ticket = Invoke-RestMethod -Method Post -Uri "$base/tickets" -Headers $admin -ContentType 'application/json' -Body (@{ title='Printer is offline'; priority='High'; project_id=$projectId; status_id=$todo.status_record.id } | ConvertTo-Json)
$ticketId = $ticket.ticket.id
Invoke-RestMethod -Uri "$base/tickets?project_id=$projectId" -Headers $admin | Select-Object total,tickets
Invoke-RestMethod -Method Put -Uri "$base/tickets/$ticketId" -Headers $admin -ContentType 'application/json' -Body (@{ status_id=$done.status_record.id; priority='Critical' } | ConvertTo-Json) | Select-Object message,ticket
Invoke-RestMethod -Uri "$base/summary/$projectId" -Headers $admin
Invoke-RestMethod -Method Delete -Uri "$base/tickets/$ticketId" -Headers $admin
```

Role denial example: sign up a second user, log in, and attempt an Admin-only DELETE. Expect HTTP 403; this is an intentional failure.

```powershell
Invoke-RestMethod -Method Post -Uri "$base/auth/signup" -ContentType 'application/json' -Body (@{ name='Uma User'; email='uma@example.test'; password='DemoPass#123' } | ConvertTo-Json)
$userLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ email='uma@example.test'; password='DemoPass#123' } | ConvertTo-Json)
$user = @{ 'x-auth-token' = $userLogin.accessToken }
try { Invoke-RestMethod -Method Delete -Uri "$base/tickets/$ticketId" -Headers $user } catch { $_.Exception.Response.StatusCode }
```

In the browser, show signup/login, the dashboard, project creation, member management, ticket creation, the board/list, and summary. Create a new project member as `User` or `Editor`; project owners can use the authenticated members route. The role chosen on the form now reaches that route. Show the API's `requireRole()` middleware and the read-only SQL role in the transcript to explain both layers of authorization.

## 6. Required modification and viva answers (item 14)

**Completed modification:** A database trigger now rejects assigning a ticket a status from another project. It automatically sets `closed_at` when the status becomes `Done` and clears it when the ticket is reopened. The SQL transcript sections 09 and 16 execute both behaviors. Public signup now forces `User`, while authenticated project owners may create `User` or `Editor` members. The frontend member form uses that protected route. The notifications query was corrected to use its Prisma relation name so the backend builds.

**Likely viva questions and answers:**

1. Why both a foreign key and a trigger for `tickets.status_id`? The foreign key proves the status exists; the trigger also proves it belongs to the ticket's project.
2. Why is `closed_at` managed by a trigger? Direct SQL updates and API updates then share the same rule.
3. What protects duplicate members? A database UNIQUE index on (`project_id`, `user_id`).
4. Why are roles checked twice? The API checks JWT roles for user actions; the demonstration SQL role shows table privileges at the database level. The live API currently uses one shared database login, so it does not switch SQL roles per request.
5. Why Redis? It caches short-lived derived data. PostgreSQL remains the authoritative store.
6. What did the modification change in the frontend? Creating a member now calls the owner-protected members endpoint directly, so public signup cannot be used to choose a privileged role.

## 7. Git/GitHub and documentation (item 13)

```powershell
git status --short
git log -5 --oneline
git diff --stat
notepad docs\DBMS_EVALUATION_RUNBOOK.md
notepad docs\ER_AND_RELATIONAL_SCHEMA.md
```

The rubric does not include a specific modification questionnaire. The completed status-trigger and signup-role changes above are concrete modifications to present for the modification/viva component. If an evaluator gives a different live modification, apply it separately and show its test result.
