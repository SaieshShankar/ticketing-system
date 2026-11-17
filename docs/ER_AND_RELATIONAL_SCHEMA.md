# Ticketing system: ER diagram and relational schema

The diagram reflects the ten PostgreSQL tables in `backend/prisma/schema.prisma`. A project owns statuses and tickets; a ticket has one creator and an optional assignee. Redis stores temporary dashboard and summary documents, outside the relational model.

```mermaid
erDiagram
  users ||--o{ projects : owns
  users |o--o{ projects : super_admins
  users ||--o{ project_members : joins
  projects ||--o{ project_members : has
  projects ||--o{ statuses : defines
  projects ||--o{ tickets : contains
  users ||--o{ tickets : creates
  users |o--o{ tickets : assigned_to
  statuses |o--o{ tickets : categorizes
  tickets ||--o{ comments : has
  users ||--o{ comments : writes
  tickets ||--o{ ticket_activity_logs : logs
  users ||--o{ ticket_activity_logs : performs
  tickets |o--o{ attachments : contains
  comments |o--o{ attachments : contains
  users ||--o{ attachments : uploads
  users ||--o{ refresh_tokens : owns
  users ||--o{ notifications : receives
  users ||--o{ notifications : acts
  tickets ||--o{ notifications : concerns
  comments |o--o{ notifications : mentions

  users {
    uuid id PK
    varchar email UK
    varchar role "CHECK four roles"
    varchar department
  }
  projects {
    uuid id PK
    uuid user_id FK
    uuid super_admin_id FK
    varchar name
  }
  project_members {
    uuid id PK
    uuid project_id FK
    uuid user_id FK
  }
  statuses {
    uuid id PK
    uuid project_id FK
    varchar name "UNIQUE(project_id,name)"
  }
  tickets {
    uuid id PK
    uuid project_id FK
    uuid created_by FK
    uuid assigned_to FK
    uuid status_id FK
    varchar ticket_number "UNIQUE(ticket_number,project_id)"
    varchar priority "CHECK allowed values"
  }
  comments {
    uuid id PK
    uuid ticket_id FK
    uuid user_id FK
  }
  attachments {
    uuid id PK
    uuid ticket_id FK
    uuid comment_id FK
    uuid user_id FK
  }
  ticket_activity_logs {
    uuid id PK
    uuid ticket_id FK
    uuid user_id FK
  }
  notifications {
    uuid id PK
    uuid user_id FK
    uuid actor_id FK
    uuid ticket_id FK
    uuid comment_id FK
  }
  refresh_tokens {
    uuid id PK
    uuid user_id FK
    varchar token_hash UK
  }
```

## Relational schema

| Relation | Primary key | Foreign keys | Other constraints |
|---|---|---|---|
| `users` | `id` | — | `email` UNIQUE; `role` CHECK (`SuperAdmin`, `Admin`, `Editor`, `User`); required name, email, password hash, role |
| `projects` | `id` | `user_id → users.id`; `super_admin_id → users.id` | required name and owner |
| `project_members` | `id` | `project_id → projects.id`; `user_id → users.id` | (`project_id`, `user_id`) UNIQUE |
| `statuses` | `id` | `project_id → projects.id` | (`project_id`, `name`) UNIQUE |
| `tickets` | `id` | `project_id → projects.id`; `created_by`, `assigned_to → users.id`; `status_id → statuses.id` | (`ticket_number`, `project_id`) UNIQUE; `priority` CHECK; trigger verifies status is in the same project |
| `comments` | `id` | `ticket_id → tickets.id`; `user_id → users.id` | required text |
| `attachments` | `id` | `ticket_id → tickets.id`; `comment_id → comments.id`; `user_id → users.id` | required file name and URL |
| `ticket_activity_logs` | `id` | `ticket_id → tickets.id`; `user_id → users.id` | action may be null |
| `notifications` | `id` | `user_id`, `actor_id → users.id`; `ticket_id → tickets.id`; `comment_id → comments.id` | `is_read` defaults false |
| `refresh_tokens` | `id` | `user_id → users.id` | `token_hash` UNIQUE; expiry required |

`backend/demo/schema.sql` is the complete executable PostgreSQL DDL generated from Prisma. `backend/demo/advanced.sql` adds CHECK constraints, the status guard trigger, and a reporting function. The SQL role demonstration in `run-demo.mjs` grants a read-only role access to selected tables and verifies that INSERT is denied. The application itself uses JWT roles in Express middleware and a shared database connection; its database role demonstration is separate from application sessions.
