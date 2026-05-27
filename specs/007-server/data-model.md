# Data Model: ArgusAI Server

**Feature**: 007-server  
**Date**: 2026-03-09

---

## Overview

The data model supports both local (SQLite) and server (PostgreSQL/MySQL) modes through Drizzle ORM dialect-specific schemas. The server adds **team**, **project**, and **notification** entities while preserving backward compatibility with existing local tables.

### Entity Relationship Diagram

```
┌─────────────┐        ┌──────────────┐       ┌──────────────────┐
│   teams      │──1:N──▶│   projects    │──1:N─▶│   test_runs       │
│              │        │              │       │                  │
│ id           │        │ id           │       │ id               │
│ name         │        │ team_id (FK) │       │ project_id (FK)  │
│ api_key_hash │        │ name         │       │ team_id (FK)     │
│ ...          │        │ ...          │       │ ...              │
└──────┬───────┘        └──────────────┘       └────────┬─────────┘
       │                                                │
       │                                                │ 1:N
       │                                                ▼
       │                                       ┌──────────────────┐
       │                                       │ test_case_runs    │
       │                                       │                  │
       │                                       │ id               │
       │                                       │ run_id (FK)      │
       │                                       │ ...              │
       │                                       └──────────────────┘
       │
       │ 1:1
       ▼
┌───────────────────┐      ┌──────────────────┐     ┌──────────────┐
│notification_configs│      │ failure_patterns  │     │ fix_history   │
│                   │      │                  │     │              │
│ team_id (FK)      │      │ id               │     │ id           │
│ webhook_url       │      │ team_id (FK)     │     │ pattern_id   │
│ ...               │      │ project_id (FK)  │     │ ...          │
└───────────────────┘      │ ...              │     └──────────────┘
                           └──────────────────┘
                           
┌──────────────┐  (local only)
│ sync_queue    │
│              │
│ id           │
│ payload      │
│ status       │
│ ...          │
└──────────────┘
```

---

## Table Definitions

### teams (server only)

Organizational unit for data isolation. Each team has one API key.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT (uuid) | PRIMARY KEY | Unique team identifier |
| name | TEXT | NOT NULL, UNIQUE | Team display name |
| api_key_hash | TEXT | NOT NULL, UNIQUE | SHA-256 hash of the API key |
| api_key_prefix | TEXT | NOT NULL | First 8 chars of raw key (for identification) |
| created_at | TEXT (ISO datetime) | NOT NULL | Creation timestamp |
| updated_at | TEXT (ISO datetime) | NOT NULL | Last update timestamp |

**Indexes**: `idx_teams_api_key_hash` on `api_key_hash` (unique), `idx_teams_name` on `name` (unique)

#### Drizzle Schema (PostgreSQL)

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
});
```

#### Drizzle Schema (SQLite — for server running on SQLite)

```typescript
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  apiKeyPrefix: text('api_key_prefix').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

---

### projects (server only)

A test target within a team. Auto-registered on first sync.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT (uuid) | PRIMARY KEY | Unique project identifier |
| team_id | TEXT (uuid) | NOT NULL, FK → teams.id | Owning team |
| name | TEXT | NOT NULL | Project name (from `e2e.yaml project.name`) |
| description | TEXT | nullable | Optional description |
| last_sync_at | TEXT (ISO datetime) | nullable | Last successful sync timestamp |
| total_runs | INTEGER | NOT NULL, DEFAULT 0 | Cached total run count |
| created_at | TEXT (ISO datetime) | NOT NULL | Auto-registration timestamp |
| updated_at | TEXT (ISO datetime) | NOT NULL | Last update timestamp |

**Indexes**: `idx_projects_team_name` on `(team_id, name)` (unique composite), `idx_projects_team_id` on `team_id`

**Uniqueness constraint**: `(team_id, name)` — different teams may have projects with the same name.

#### Drizzle Schema (PostgreSQL)

```typescript
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  lastSyncAt: timestamp('last_sync_at', { mode: 'string' }),
  totalRuns: integer('total_runs').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  teamNameUnique: uniqueIndex('idx_projects_team_name').on(table.teamId, table.name),
}));
```

---

### test_runs (modified — adds server columns)

Persistent record for a complete test run. **Existing columns preserved** for backward compatibility.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Run UUID (generated locally) |
| project | TEXT | NOT NULL | Project name (local mode) |
| team_id | TEXT (uuid) | nullable, FK → teams.id | Server: owning team (NULL for local-only) |
| project_id | TEXT (uuid) | nullable, FK → projects.id | Server: project reference (NULL for local-only) |
| timestamp | INTEGER | NOT NULL | Run start time (epoch ms) |
| git_commit | TEXT | nullable | Git commit SHA |
| git_branch | TEXT | nullable | Git branch name |
| config_hash | TEXT | NOT NULL | Config hash for change detection |
| trigger | TEXT | NOT NULL | Trigger source: cli, mcp, dashboard, ci |
| duration | INTEGER | NOT NULL, DEFAULT 0 | Total duration (ms) |
| passed | INTEGER | NOT NULL, DEFAULT 0 | Passed case count |
| failed | INTEGER | NOT NULL, DEFAULT 0 | Failed case count |
| skipped | INTEGER | NOT NULL, DEFAULT 0 | Skipped case count |
| flaky | INTEGER | NOT NULL, DEFAULT 0 | Flaky case count |
| status | TEXT | NOT NULL | Overall: 'passed' or 'failed' |
| source_developer | TEXT | nullable | Developer identifier (for server attribution) |
| synced_at | TEXT (ISO datetime) | nullable | When this run was synced to server |
| created_at | TEXT | NOT NULL | Record creation timestamp |

**New columns** (`team_id`, `project_id`, `source_developer`, `synced_at`) are all nullable to maintain backward compatibility with existing local databases.

**Existing indexes preserved**:
- `idx_runs_project_ts` on `(project, timestamp DESC)`
- `idx_runs_project_status` on `(project, status)`

**New indexes** (server):
- `idx_runs_team_project` on `(team_id, project_id, timestamp DESC)`
- `idx_runs_synced_at` on `synced_at` (for sync tracking)

#### Drizzle Schema (PostgreSQL)

```typescript
export const testRuns = pgTable('test_runs', {
  id: text('id').primaryKey(),
  project: text('project').notNull(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  gitCommit: text('git_commit'),
  gitBranch: text('git_branch'),
  configHash: text('config_hash').notNull(),
  trigger: text('trigger').notNull(),
  duration: integer('duration').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  status: text('status').notNull(),
  sourceDeveloper: text('source_developer'),
  syncedAt: timestamp('synced_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  projectTsIdx: index('idx_runs_project_ts').on(table.project, table.timestamp),
  teamProjectIdx: index('idx_runs_team_project').on(table.teamId, table.projectId, table.timestamp),
}));
```

#### Drizzle Schema (SQLite)

```typescript
export const testRuns = sqliteTable('test_runs', {
  id: text('id').primaryKey(),
  project: text('project').notNull(),
  teamId: text('team_id'),
  projectId: text('project_id'),
  timestamp: integer('timestamp').notNull(),
  gitCommit: text('git_commit'),
  gitBranch: text('git_branch'),
  configHash: text('config_hash').notNull(),
  trigger: text('trigger').notNull(),
  duration: integer('duration').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  flaky: integer('flaky').notNull().default(0),
  status: text('status').notNull(),
  sourceDeveloper: text('source_developer'),
  syncedAt: text('synced_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  projectTsIdx: index('idx_runs_project_ts').on(table.project, table.timestamp),
  teamProjectIdx: index('idx_runs_team_project').on(table.teamId, table.projectId, table.timestamp),
}));
```

---

### test_case_runs (unchanged structure)

Persistent record for a single test case outcome. No structural changes needed — cases are always linked to a run via `run_id`, and the run carries the team/project context.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Case run UUID |
| run_id | TEXT | NOT NULL, FK → test_runs.id CASCADE | Parent run |
| suite_id | TEXT | NOT NULL | Suite identifier |
| case_name | TEXT | NOT NULL | Test case name |
| status | TEXT | NOT NULL | passed, failed, skipped |
| duration | INTEGER | NOT NULL, DEFAULT 0 | Duration (ms) |
| attempts | INTEGER | NOT NULL, DEFAULT 1 | Retry attempt count |
| response_ms | INTEGER | nullable | HTTP response time |
| assertions | INTEGER | nullable | Assertion count |
| error | TEXT | nullable | Error message (max 2000 chars) |
| snapshot | TEXT | nullable | Diagnostic snapshot JSON |
| created_at | TEXT | NOT NULL | Record creation timestamp |

**Indexes** (unchanged):
- `idx_cases_run_id` on `run_id`
- `idx_cases_suite_case` on `(suite_id, case_name)`
- `idx_cases_name_ts` on `(case_name, created_at DESC)`

---

### failure_patterns (modified — adds server columns)

Core knowledge entity for diagnostic patterns.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Pattern UUID |
| team_id | TEXT (uuid) | nullable, FK → teams.id | Server: owning team (NULL for local) |
| project_id | TEXT (uuid) | nullable, FK → projects.id | Server: project (NULL for cross-project) |
| category | TEXT | NOT NULL | Failure category enum |
| signature | TEXT | NOT NULL | Unique error signature |
| signature_pattern | TEXT | NOT NULL | Regex pattern for matching |
| description | TEXT | NOT NULL, DEFAULT '' | Human-readable description |
| suggested_fix | TEXT | NOT NULL, DEFAULT '' | Suggested resolution |
| confidence | REAL | NOT NULL, DEFAULT 0.5 | Confidence score [0, 1] |
| occurrences | INTEGER | NOT NULL, DEFAULT 0 | Total occurrence count |
| resolutions | INTEGER | NOT NULL, DEFAULT 0 | Successful fix count |
| source | TEXT | NOT NULL, DEFAULT 'learned' | 'built-in' or 'learned' |
| first_seen_at | TEXT | NOT NULL | First occurrence |
| last_seen_at | TEXT | NOT NULL | Most recent occurrence |
| created_at | TEXT | NOT NULL | Record creation |
| updated_at | TEXT | NOT NULL | Last update |

**New columns**: `team_id`, `project_id` (both nullable for backward compat).

**Uniqueness on server**: `(team_id, signature)` — same signature from different teams creates separate patterns.

**New index**: `idx_patterns_team_sig` on `(team_id, signature)` (unique where team_id is not null)

---

### fix_history (unchanged structure)

Historical fix attempts linked to patterns. No changes needed.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Fix record UUID |
| pattern_id | TEXT | NOT NULL, FK → failure_patterns.id CASCADE | Parent pattern |
| run_id | TEXT | NOT NULL | Associated test run |
| case_name | TEXT | NOT NULL | Test case that was fixed |
| fix_description | TEXT | NOT NULL | Description of the fix |
| success | INTEGER | NOT NULL, DEFAULT 1 | 1 = success, 0 = failure |
| created_at | TEXT | NOT NULL | Record creation |

---

### notification_configs (server only)

Per-team notification configuration.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT (uuid) | PRIMARY KEY | Config UUID |
| team_id | TEXT (uuid) | NOT NULL, FK → teams.id, UNIQUE | One config per team |
| webhook_url | TEXT | nullable | 企微 webhook URL |
| on_failure | INTEGER | NOT NULL, DEFAULT 1 | Notify on test failures |
| on_success | INTEGER | NOT NULL, DEFAULT 0 | Notify on all pass |
| on_new_flaky | INTEGER | NOT NULL, DEFAULT 0 | Notify on new flaky detection |
| daily_digest | INTEGER | NOT NULL, DEFAULT 0 | Enable daily summary |
| digest_time | TEXT | DEFAULT '09:00' | Daily digest time (HH:mm) |
| digest_timezone | TEXT | DEFAULT 'Asia/Shanghai' | Timezone for digest |
| created_at | TEXT (ISO datetime) | NOT NULL | Creation timestamp |
| updated_at | TEXT (ISO datetime) | NOT NULL | Last update |

#### Drizzle Schema (PostgreSQL)

```typescript
export const notificationConfigs = pgTable('notification_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().unique().references(() => teams.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url'),
  onFailure: boolean('on_failure').notNull().default(true),
  onSuccess: boolean('on_success').notNull().default(false),
  onNewFlaky: boolean('on_new_flaky').notNull().default(false),
  dailyDigest: boolean('daily_digest').notNull().default(false),
  digestTime: text('digest_time').default('09:00'),
  digestTimezone: text('digest_timezone').default('Asia/Shanghai'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
});
```

---

### sync_queue (local only)

Local queue for buffering sync payloads when the server is unreachable.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Queue entry UUID |
| payload | TEXT | NOT NULL | JSON-serialized sync data |
| type | TEXT | NOT NULL | 'run' or 'patterns' |
| status | TEXT | NOT NULL, DEFAULT 'pending' | pending, sending, completed, failed |
| attempts | INTEGER | NOT NULL, DEFAULT 0 | Send attempt count |
| max_retries | INTEGER | NOT NULL, DEFAULT 10 | Maximum retry attempts |
| created_at | TEXT | NOT NULL | Enqueue timestamp |
| next_retry_at | TEXT | NOT NULL | Next scheduled retry (ISO datetime) |
| last_error | TEXT | nullable | Last failure error message |

**Indexes**: `idx_sync_queue_status` on `(status, next_retry_at)`

#### Drizzle Schema (SQLite only)

```typescript
export const syncQueue = sqliteTable('sync_queue', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(10),
  createdAt: text('created_at').notNull(),
  nextRetryAt: text('next_retry_at').notNull(),
  lastError: text('last_error'),
}, (table) => ({
  statusRetryIdx: index('idx_sync_queue_status').on(table.status, table.nextRetryAt),
}));
```

---

## Migration Strategy

### Migration v3: Add Server Columns (Local SQLite)

This migration bridges existing v2 databases to the new schema:

```sql
-- Add nullable server columns to test_runs
ALTER TABLE test_runs ADD COLUMN team_id TEXT;
ALTER TABLE test_runs ADD COLUMN project_id TEXT;
ALTER TABLE test_runs ADD COLUMN source_developer TEXT;
ALTER TABLE test_runs ADD COLUMN synced_at TEXT;

-- Add nullable server columns to failure_patterns
ALTER TABLE failure_patterns ADD COLUMN team_id TEXT;
ALTER TABLE failure_patterns ADD COLUMN project_id TEXT;

-- Create sync_queue table
CREATE TABLE IF NOT EXISTS sync_queue (
  id            TEXT PRIMARY KEY,
  payload       TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('run', 'patterns')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'completed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 10,
  created_at    TEXT NOT NULL,
  next_retry_at TEXT NOT NULL,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_runs_team_project ON test_runs(team_id, project_id, timestamp DESC);
```

**Key property**: All `ALTER TABLE ADD COLUMN` statements use nullable columns with no constraints, so existing rows are unaffected.

### Server First-Run Migration

When the server starts for the first time, Drizzle creates all tables:

1. `teams`
2. `projects`
3. `test_runs` (with all columns including server-specific ones)
4. `test_case_runs`
5. `failure_patterns` (with team/project columns)
6. `fix_history`
7. `notification_configs`

No `sync_queue` table on the server — that's local-only.

---

## State Transitions

### Sync Queue Entry Lifecycle

```
            ┌──────────┐
            │ pending   │◀──── enqueue()
            └─────┬────┘
                  │ dequeue() picks oldest pending
                  ▼
            ┌──────────┐
            │ sending   │
            └─────┬────┘
                  │
          ┌───────┴───────┐
          │               │
     success         failure (attempts < max)
          │               │
          ▼               ▼
    ┌──────────┐    ┌──────────┐
    │ completed │    │ pending   │ (with incremented attempts + backoff)
    └──────────┘    └──────────┘
                          │
                    failure (attempts >= max)
                          │
                          ▼
                    ┌──────────┐
                    │ failed    │ (permanent failure, logged)
                    └──────────┘
```

### Team API Key Lifecycle

```
     POST /api/teams { name }
              │
              ▼
     Generate raw key + hash
     Store hash in DB
     Return raw key (ONE TIME)
              │
              ▼
     Key in active use (X-API-Key header)
              │
     POST /api/teams/:id/reset-key
              │
              ▼
     Generate new raw key + hash
     UPDATE hash in DB (old key immediately invalid)
     Return new raw key (ONE TIME)
```

---

## Validation Rules

| Entity | Rule | Implementation |
|--------|------|----------------|
| Team name | 1-100 chars, alphanumeric + hyphen + underscore | Zod: `z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)` |
| Project name | 1-200 chars, any printable | Zod: `z.string().min(1).max(200)` |
| API key | 64-char hex string | Generated: `crypto.randomBytes(32).toString('hex')` |
| Webhook URL | Valid HTTPS URL, `qyapi.weixin.qq.com` domain | Zod: `z.string().url()` |
| Sync payload | Max 10MB uncompressed | Fastify body limit config |
| Test run ID | UUID v4 format | Zod: `z.string().uuid()` or `z.string().min(1)` |
| Error text | Max 2000 chars (truncated) | Store layer truncation |
