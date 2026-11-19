# Ticketing System

**Full-stack web application · PostgreSQL · Redis · Next.js**

A project and ticket-management application with authentication, project views, ticket workflows, notifications, summaries, and attachment handling.

## Architecture

| Layer | Technology | Source |
| --- | --- | --- |
| Frontend | Next.js, React, TypeScript, Redux | [frontend/](frontend/) |
| API | Express and TypeScript | [backend/src/](backend/src/) |
| Relational data | PostgreSQL and Prisma | [Schema](backend/prisma/schema.prisma) |
| Cache | Redis | [Cache helpers](backend/src/lib/cache.ts) |
| Attachments | Supabase storage | [Storage helpers](backend/src/lib/supabase.ts) |

## Start here

- [Demonstration and DBMS evaluation runbook](docs/DBMS_EVALUATION_RUNBOOK.md)
- [ER diagram and relational schema](docs/ER_AND_RELATIONAL_SCHEMA.md)
- [Executable database demo](backend/demo/run-demo.mjs)
- [SQL schema](backend/demo/schema.sql) and [additional SQL routines](backend/demo/advanced.sql)

## Local development

Install Node.js and prepare the PostgreSQL, Redis, and Supabase configuration described in the runbook. Copy [backend/.env.example](backend/.env.example) to a local `backend/.env` and [frontend/.env.example](frontend/.env.example) to `frontend/.env.local`, then fill in your own values.

From `backend/`:

```bash
npm ci
npx prisma generate
npm run dev
```

From `frontend/` in a second terminal:

```bash
npm ci
npm run dev
```

The development frontend uses port **3001**; the backend example uses **3000**. Database initialisation and demo-specific commands are documented in the runbook.

## Validation commands

Run `npm run build` within each application directory. The frontend also exposes `npm run lint`. These are available checks; this documentation update does not claim a fresh application or database test.
