# Tasks: ArgusAI Server — Platformization Service Layer

**Feature**: 007-server  
**Generated**: 2026-03-09  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Total Tasks**: 62 | **Phases**: 5

---

## Summary

| Phase | Name | Tasks | Stories |
|-------|------|-------|---------|
| Phase 1 | Setup & Scaffolding | T001–T005 | — |
| Phase 2 | Foundational — Drizzle ORM Migration | T006–T016 | US4 |
| Phase 3 | Core Infrastructure — Sync & Server API | T017–T040 | US1, US2, US3, US5, US10 |
| Phase 4 | Collaboration Features | T041–T055 | US6, US7, US8 |
| Phase 5 | Deployment & Polish | T056–T062 | US9 |

---

## Phase 1 — Setup & Scaffolding

**Goal**: Initialize the new `packages/server/` package and install all new dependencies. No user story label — these are project-infrastructure tasks.

- [X] T001 Scaffold `packages/server/` package with `package.json`, `tsconfig.json`, ESM + strict mode configuration
  - **Files**: `packages/server/package.json`, `packages/server/tsconfig.json`
  - **Details**: Create `package.json` with `"type": "module"`, dependencies `fastify@^5`, `drizzle-orm`, `pg`, `mysql2`, `zod`, `argusai-core` (workspace ref). `tsconfig.json` extends root config with `strict: true`. Add `packages/server` to root `pnpm-workspace.yaml`.
  - **Acceptance**: `pnpm install` succeeds; `tsc --noEmit` passes on empty `src/index.ts`.
  - **Complexity**: Low

- [X] T002 Add Drizzle ORM dependencies to `packages/core/`
  - **Files**: `packages/core/package.json`
  - **Details**: Add `drizzle-orm` as dependency and `drizzle-kit` as devDependency. Keep `better-sqlite3` (Drizzle uses it as SQLite driver). Add `pg` and `mysql2` as optional peer dependencies.
  - **Acceptance**: `pnpm install` succeeds; Drizzle imports resolve in TypeScript.
  - **Complexity**: Low

- [X] T003 [P] Create `packages/server/src/index.ts` entry point stub and `packages/server/src/app.ts` Fastify app factory stub
  - **Files**: `packages/server/src/index.ts`, `packages/server/src/app.ts`
  - **Details**: `app.ts` exports `createServerApp()` returning a Fastify instance with CORS plugin. `index.ts` reads env config and calls `createServerApp()` then `app.listen()`. Both are minimal stubs to verify the build pipeline works.
  - **Acceptance**: `pnpm --filter argusai-server build` succeeds.
  - **Complexity**: Low

- [X] T004 [P] Create `packages/server/src/config.ts` — Zod server config schema
  - **Files**: `packages/server/src/config.ts`
  - **Details**: Define `ServerEnvConfigSchema` using Zod for environment variables: `DATABASE_URL` (required), `DATABASE_DIALECT` (`sqlite | pg | mysql`, default `pg`), `PORT` (default 3000), `HOST` (default `0.0.0.0`), `LOG_LEVEL` (default `info`). Export `loadServerConfig()` that parses `process.env`.
  - **Acceptance**: `loadServerConfig()` returns typed config when required env vars are set; throws `ZodError` when `DATABASE_URL` is missing.
  - **Complexity**: Low

- [X] T005 [P] Add `@fastify/cors` and `@fastify/swagger` dependencies to `packages/server/`
  - **Files**: `packages/server/package.json`
  - **Details**: Add `@fastify/cors@^10`, `@fastify/swagger@^9`, `@fastify/swagger-ui@^5` as dependencies.
  - **Acceptance**: Imports resolve; no version conflicts.
  - **Complexity**: Low

---

## Phase 2 — Foundational: Drizzle ORM Migration (US4)

**Goal**: Replace direct `better-sqlite3` calls with Drizzle ORM. Existing local behavior is unchanged. This phase MUST complete before any server or sync work.

**Independent test**: Run the full existing test suite (`pnpm --filter argusai-core test`) and verify all tests pass with zero diff in behavior.

### Drizzle Schema Definitions

- [X] T006 [US4] Create SQLite Drizzle schema at `packages/core/src/db/schema-sqlite.ts`
  - **Files**: `packages/core/src/db/schema-sqlite.ts`
  - **Details**: Define `testRuns`, `testCaseRuns`, `failurePatterns`, `fixHistory`, `syncQueue` tables using `sqliteTable()`. Column names and types MUST exactly match the existing migration output in `packages/core/src/history/migrations.ts` (v1 + v2). Add new nullable columns: `team_id`, `project_id`, `source_developer`, `synced_at` on `test_runs`; `team_id`, `project_id` on `failure_patterns`. Add indexes matching existing ones plus new `idx_runs_team_project`, `idx_sync_queue_status`.
  - **Acceptance**: TypeScript compiles with no errors. Schema columns match existing DB schema.
  - **Complexity**: Medium

- [X] T007 [P] [US4] Create PostgreSQL Drizzle schema at `packages/core/src/db/schema-pg.ts`
  - **Files**: `packages/core/src/db/schema-pg.ts`
  - **Details**: Define all tables using `pgTable()` with PostgreSQL-native types: `uuid().defaultRandom()` for IDs, `timestamp()` for datetimes, `integer()` / `bigint()` for numbers. Additionally define server-only tables: `teams`, `projects`, `notificationConfigs`. Include all indexes and unique constraints from data-model.md. Foreign keys with `onDelete: 'cascade'` for team → project → run → case chain.
  - **Acceptance**: TypeScript compiles. Schema matches data-model.md ERD exactly.
  - **Complexity**: Medium

- [X] T008 [P] [US4] Create MySQL Drizzle schema at `packages/core/src/db/schema-mysql.ts`
  - **Files**: `packages/core/src/db/schema-mysql.ts`
  - **Details**: Mirror PostgreSQL schema using `mysqlTable()` with MySQL-native types: `varchar(36)` for UUIDs, `datetime` for timestamps, `int` / `bigint` for numbers. Same tables, columns, indexes, and constraints as PG schema.
  - **Acceptance**: TypeScript compiles. Schema matches PG schema structurally.
  - **Complexity**: Medium

### Database Connection Factory

- [X] T009 [US4] Create `packages/core/src/db/create-db.ts` — Drizzle DB connection factory
  - **Files**: `packages/core/src/db/create-db.ts`
  - **Details**: Export `DbConfig` interface with `dialect: 'sqlite' | 'pg' | 'mysql'`, `connectionString?: string`, `filePath?: string`. Export `createDb(config: DbConfig)` that: (1) for `sqlite`: `drizzle(new Database(filePath))` with SQLite schema; (2) for `pg`: `drizzle(new Pool({ connectionString }))` with PG schema; (3) for `mysql`: `drizzle(createPool(connectionString))` with MySQL schema. Return type is a union but expose a common query interface via the Drizzle db object.
  - **Acceptance**: `createDb({ dialect: 'sqlite', filePath: ':memory:' })` returns a working Drizzle instance.
  - **Complexity**: Medium

### Drizzle Store Implementations

- [X] T010 [US4] Implement `DrizzleHistoryStore` at `packages/core/src/db/drizzle-history-store.ts`
  - **Files**: `packages/core/src/db/drizzle-history-store.ts`
  - **Details**: Implement the `HistoryStore` interface using Drizzle's query builder API. Methods: `saveRun()` uses `db.insert(testRuns).values(...)` + `db.insert(testCaseRuns).values(...)` in a transaction; `getRuns()` uses `db.select().from(testRuns).where(...)` with dynamic conditions, `ORDER BY timestamp DESC`, `LIMIT/OFFSET`; `getRunById()` queries run + cases; `getCaseHistory()` uses a join on `testCaseRuns` and `testRuns`; `getRunsInDateRange()`, `getCasesForRun()`, `getDistinctCaseNames()`, `cleanup()` all implemented using Drizzle query builder. All queries must be dialect-agnostic (no raw SQL). Accept a generic Drizzle db instance + schema reference object so the same implementation works with any dialect.
  - **Acceptance**: All methods produce identical results to `SQLiteHistoryStore` when tested against SQLite.
  - **Complexity**: High

- [X] T011 [US4] Implement `DrizzleKnowledgeStore` at `packages/core/src/db/drizzle-knowledge-store.ts`
  - **Files**: `packages/core/src/db/drizzle-knowledge-store.ts`
  - **Details**: Implement the `KnowledgeStore` interface from `packages/core/src/knowledge/knowledge-store.ts` using Drizzle ORM. Match all methods of the existing `SQLiteKnowledgeStore`: `savePattern()`, `getPatterns()`, `getPatternBySignature()`, `updatePattern()`, `saveFix()`, `getFixes()`, etc. Use Drizzle query builder for all operations.
  - **Acceptance**: All methods produce identical results to `SQLiteKnowledgeStore`.
  - **Complexity**: High

- [X] T012 [US4] Create `packages/core/src/db/index.ts` barrel export
  - **Files**: `packages/core/src/db/index.ts`
  - **Details**: Re-export `createDb`, `DbConfig`, `DrizzleHistoryStore`, `DrizzleKnowledgeStore`, and all three schema modules (for consumers that need dialect-specific references).
  - **Acceptance**: `import { createDb, DrizzleHistoryStore } from './db/index.js'` resolves.
  - **Complexity**: Low

### Migration Bridge

- [X] T013 [US4] Add migration v3 (Drizzle bridge) to `packages/core/src/history/migrations.ts`
  - **Files**: `packages/core/src/history/migrations.ts`
  - **Details**: Add a v3 migration function that: (1) Adds `team_id TEXT`, `project_id TEXT`, `source_developer TEXT`, `synced_at TEXT` columns to `test_runs` via `ALTER TABLE ADD COLUMN` (all nullable, no defaults); (2) Adds `team_id TEXT`, `project_id TEXT` columns to `failure_patterns`; (3) Creates `sync_queue` table per data-model.md; (4) Creates new indexes `idx_runs_team_project`, `idx_sync_queue_status`, `idx_patterns_team_sig`. Update `applyMigrations()` to run v3 when `user_version < 3` then set `user_version = 3`.
  - **Acceptance**: A v2 database is upgraded to v3 with no data loss. All new columns are NULL for existing rows. New tables exist.
  - **Complexity**: Medium

### Factory Update

- [X] T014 [US4] Update `createHistoryStore()` factory to use `DrizzleHistoryStore` as default
  - **Files**: `packages/core/src/history/history-store.ts`
  - **Details**: Modify the `storage: 'local'` path in `createHistoryStore()` to: (1) Open SQLite database with `better-sqlite3` as before; (2) Apply migrations (including v3); (3) Create a Drizzle instance wrapping the `better-sqlite3` database; (4) Return `DrizzleHistoryStore` instead of `SQLiteHistoryStore`. The `SQLiteHistoryStore` class remains for backward compatibility but is no longer the default. The `MemoryHistoryStore` and `NoopHistoryStore` paths are unchanged.
  - **Acceptance**: Existing tests pass without modification. `createHistoryStore()` returns a `DrizzleHistoryStore` backed by SQLite.
  - **Complexity**: Medium

- [X] T015 [US4] Update knowledge store factory to use `DrizzleKnowledgeStore` as default
  - **Files**: `packages/core/src/knowledge/knowledge-store.ts`
  - **Details**: Similar to T014 — update the factory function so that when creating a local knowledge store, it wraps the shared `better-sqlite3` database with a Drizzle instance and returns `DrizzleKnowledgeStore`. The existing `SQLiteKnowledgeStore` remains for backward compat.
  - **Acceptance**: Existing knowledge store tests pass without modification.
  - **Complexity**: Medium

### Phase 2 Testing

- [X] T016 [US4] Write unit tests for Drizzle stores and migration bridge
  - **Files**: `packages/core/tests/unit/db/drizzle-history-store.test.ts`, `packages/core/tests/unit/db/drizzle-knowledge-store.test.ts`, `packages/core/tests/unit/db/migration-v3.test.ts`
  - **Details**: (1) `drizzle-history-store.test.ts`: Test all `HistoryStore` methods against in-memory SQLite via Drizzle — mirror existing `history-store.test.ts` assertions. (2) `drizzle-knowledge-store.test.ts`: Test all `KnowledgeStore` methods. (3) `migration-v3.test.ts`: Create a v2 database with test data, run v3 migration, verify: all existing data intact, new columns exist and are NULL, `sync_queue` table created, `user_version = 3`. Target coverage: ≥85%.
  - **Acceptance**: All tests pass. Coverage ≥85% for `db/` directory.
  - **Complexity**: Medium

---

## Phase 3 — Core Infrastructure: Sync Pipeline & Server API (US1, US2, US3, US5, US10)

**Goal**: Build the sync queue, sync client, RemoteHistoryStore, server REST API, authentication, and team/project management. After this phase, local → server sync works end-to-end.

### P3.1 — e2e.yaml Config Extension (US1, US10)

- [X] T017 [US1] Extend `E2EConfigSchema` with optional `server` section in `packages/core/src/config-loader.ts`
  - **Files**: `packages/core/src/config-loader.ts`, `packages/core/src/types.ts`
  - **Details**: Add `ServerConfigSchema = z.object({ url: z.string().url(), apiKey: z.string().min(1), team: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), sync: z.enum(['auto', 'manual', 'disabled']).default('auto') }).optional()` to the existing `E2EConfigSchema`. Add `ServerConfig` TypeScript interface to `types.ts`. Update `loadConfig()` to resolve `server.apiKey` env var substitution and check `ARGUSAI_API_KEY` env override.
  - **Acceptance**: `e2e.yaml` without `server` section parses identically to before. With `server` section, `ServerConfig` is populated. `ARGUSAI_API_KEY` env var overrides `server.apiKey`.
  - **Complexity**: Low

- [X] T018 [P] [US1] Write unit tests for server config parsing
  - **Files**: `packages/core/tests/unit/config-loader-server.test.ts`
  - **Details**: Test cases: (1) No `server` section → config.server is undefined; (2) Valid server section → parsed correctly; (3) Missing `url` → validation error; (4) `ARGUSAI_API_KEY` env override; (5) Invalid sync mode → validation error; (6) Team name with special chars → validation error.
  - **Acceptance**: All tests pass.
  - **Complexity**: Low

### P3.2 — Sync Infrastructure (US1, US10)

- [X] T019 [US1] Implement `SyncQueue` at `packages/core/src/sync/sync-queue.ts`
  - **Files**: `packages/core/src/sync/sync-queue.ts`
  - **Details**: Class `SyncQueue` backed by the `sync_queue` table in the local SQLite database (via Drizzle). Methods: `enqueue(type: 'run' | 'patterns', payload: object): string` — inserts with `status: 'pending'`, `nextRetryAt: now`; `getPending(limit = 5): SyncQueueEntry[]` — selects where `status = 'pending' AND nextRetryAt <= now` ordered by `created_at ASC`; `markSending(id)` — updates status to `sending`; `markCompleted(id)` — updates status to `completed`; `markFailed(id, error)` — increments `attempts`, calculates exponential backoff (`min(5000 * 2^attempts, 300000)` ms), sets `nextRetryAt`, if `attempts >= maxRetries` sets `status = 'failed'`; `getStats()` — returns counts by status; `cleanup()` — deletes completed entries.
  - **Acceptance**: Enqueue → getPending returns entry. markFailed with backoff. markCompleted removes from pending.
  - **Complexity**: Medium

- [X] T020 [US1] Implement `SyncClient` at `packages/core/src/sync/sync-client.ts`
  - **Files**: `packages/core/src/sync/sync-client.ts`
  - **Details**: Class `SyncClient` with constructor `(serverUrl: string, apiKey: string)`. Methods: `syncRuns(payload: SyncRunsPayload): Promise<SyncRunsResponse>` — POST to `/api/sync/runs` with `X-API-Key` header, 30s timeout via `AbortSignal.timeout(30000)`, JSON body; `syncPatterns(payload: SyncPatternsPayload): Promise<SyncPatternsResponse>` — POST to `/api/sync/patterns`; `ping(): Promise<boolean>` — GET `/api/health`, returns true if 200. Use native `fetch` (Node 20+). Export TypeScript interfaces for payloads and responses matching sync-api.md contract.
  - **Acceptance**: Makes correct HTTP requests with proper headers, timeout, and body serialization. Throws on non-2xx.
  - **Complexity**: Medium

- [X] T021 [US1] Implement `SyncManager` at `packages/core/src/sync/sync-manager.ts`
  - **Files**: `packages/core/src/sync/sync-manager.ts`
  - **Details**: Class `SyncManager` with constructor `(syncQueue: SyncQueue, syncClient: SyncClient)`. Methods: `start()` — starts a `setInterval` (30s) that calls `processQueue()`; `stop()` — clears interval; `syncNow(): Promise<SyncResult>` — processes all pending entries immediately (for CLI `argusai sync`); `getStatus(): SyncStatus` — returns `{ pending, sending, failed, lastSyncAt, lastError }`. Private `processQueue()`: get up to 5 pending entries, for each: markSending → call syncClient → markCompleted on success / markFailed on error. Process sequentially (preserve ordering). All errors caught — never throws. Logs warnings on sync failure.
  - **Acceptance**: Background timer processes queue. `syncNow()` drains queue. Failures are caught and logged, not thrown.
  - **Complexity**: Medium

- [X] T022 [US1] Implement `RemoteHistoryStore` at `packages/core/src/sync/remote-history-store.ts`
  - **Files**: `packages/core/src/sync/remote-history-store.ts`
  - **Details**: Decorator class `RemoteHistoryStore implements HistoryStore`. Constructor takes `(local: HistoryStore, syncQueue: SyncQueue, serverConfig: ServerConfig)`. `saveRun(run, cases)`: calls `local.saveRun(run, cases)` synchronously, then calls `syncQueue.enqueue('run', { project: run.project, team: serverConfig.team, sourceDeveloper: os.hostname(), run, cases })` — enqueue is fire-and-forget (catch and log errors). All read methods (`getRuns`, `getRunById`, etc.) delegate directly to `local`. `close()`: calls `local.close()`.
  - **Acceptance**: `saveRun` writes locally AND enqueues. All reads hit local store. Enqueue failure does not affect local write.
  - **Complexity**: Medium

- [X] T023 [US10] Update `createHistoryStore()` to support `RemoteHistoryStore` wrapping
  - **Files**: `packages/core/src/history/history-store.ts`
  - **Details**: Modify `createHistoryStore()` to accept an optional `serverConfig?: ServerConfig` parameter. If `serverConfig` is present and `serverConfig.sync !== 'disabled'`: (1) Create the local `DrizzleHistoryStore` as normal; (2) Create a `SyncQueue` using the same SQLite DB; (3) Create a `SyncClient` with `serverConfig.url` and resolved API key; (4) Wrap with `RemoteHistoryStore(localStore, syncQueue, serverConfig)`; (5) Create and start a `SyncManager` for background processing. If no `serverConfig` or `sync === 'disabled'`: return local store only (unchanged behavior).
  - **Acceptance**: Without server config: identical to current behavior. With server config: `saveRun` enqueues sync. With `sync: 'disabled'`: no sync infrastructure created.
  - **Complexity**: Medium

- [X] T024 [P] [US1] Create `packages/core/src/sync/index.ts` barrel export
  - **Files**: `packages/core/src/sync/index.ts`
  - **Details**: Re-export `SyncQueue`, `SyncClient`, `SyncManager`, `RemoteHistoryStore`, and all sync-related types.
  - **Acceptance**: Barrel import resolves all sync module exports.
  - **Complexity**: Low

- [X] T025 [US1] Write unit tests for sync infrastructure
  - **Files**: `packages/core/tests/unit/sync/sync-queue.test.ts`, `packages/core/tests/unit/sync/sync-client.test.ts`, `packages/core/tests/unit/sync/sync-manager.test.ts`, `packages/core/tests/unit/sync/remote-history-store.test.ts`
  - **Details**: (1) `sync-queue.test.ts`: enqueue, getPending ordering, markSending/markCompleted/markFailed, exponential backoff calculation, max retries → permanent failure, getStats, cleanup. (2) `sync-client.test.ts`: Mock `fetch` to verify correct URL/headers/body, timeout handling, error responses. (3) `sync-manager.test.ts`: background timer calls processQueue, syncNow drains queue, error isolation (one failure doesn't block others). (4) `remote-history-store.test.ts`: saveRun writes locally + enqueues, read methods delegate to local, enqueue failure doesn't fail saveRun. Target coverage: ≥85%.
  - **Acceptance**: All tests pass. ≥85% coverage for `sync/` directory.
  - **Complexity**: Medium

### P3.3 — Server Authentication (US2)

- [X] T026 [US2] Implement API key generation and hashing at `packages/server/src/auth/api-key.ts`
  - **Files**: `packages/server/src/auth/api-key.ts`
  - **Details**: Export functions: `generateApiKey(): { rawKey: string; hash: string; prefix: string }` — uses `crypto.randomBytes(32).toString('hex')` for 64-char hex key, `crypto.createHash('sha256')` for hash, first 8 chars as prefix; `hashApiKey(raw: string): string` — SHA-256 hash; `validateApiKey(raw: string, hash: string): boolean` — compare hashes.
  - **Acceptance**: Generated keys are 64 chars hex. Hash is deterministic. Validation works correctly.
  - **Complexity**: Low

- [X] T027 [US2] Implement Fastify auth hook at `packages/server/src/auth/auth-hook.ts`
  - **Files**: `packages/server/src/auth/auth-hook.ts`
  - **Details**: Export `createAuthHook(db)` returning a Fastify `preHandler` hook. The hook: (1) Extracts `X-API-Key` from request headers; (2) If missing, returns 401 with `{ success: false, error: "Invalid or missing API key", code: "AUTH_INVALID_KEY" }`; (3) Hashes the key, queries `teams` table; (4) If no match, returns 401; (5) If match, injects `request.teamId` and `request.teamName` into the request object via Fastify decorators. Public routes (`/api/health`, `POST /api/teams`) bypass auth.
  - **Acceptance**: Valid key → request proceeds with teamId. Invalid/missing → 401 response. Public routes bypass auth.
  - **Complexity**: Medium

- [X] T028 [P] [US2] Write unit tests for auth system
  - **Files**: `packages/server/tests/unit/auth/api-key.test.ts`, `packages/server/tests/unit/auth/auth-hook.test.ts`
  - **Details**: (1) `api-key.test.ts`: key generation format, hash determinism, validation. (2) `auth-hook.test.ts`: Mock Fastify request/reply — valid key passes, invalid key returns 401, missing header returns 401, public routes bypass.
  - **Acceptance**: All tests pass.
  - **Complexity**: Low

### P3.4 — Server Database Connection (US5)

- [X] T029 [US5] Implement server DB connection at `packages/server/src/db/connection.ts`
  - **Files**: `packages/server/src/db/connection.ts`
  - **Details**: Export `createServerDb(config: ServerEnvConfig)` that calls `createDb()` from `argusai-core` with the server's `DATABASE_URL` and `DATABASE_DIALECT`. Returns typed Drizzle instance. For PostgreSQL: uses `pg.Pool` with connection string. For MySQL: uses `mysql2.createPool`. For SQLite: uses `better-sqlite3`.
  - **Acceptance**: Connects to configured database. Throws descriptive error on connection failure.
  - **Complexity**: Low

- [X] T030 [US5] Implement Drizzle migration runner at `packages/server/src/db/migrate.ts`
  - **Files**: `packages/server/src/db/migrate.ts`
  - **Details**: Export `runMigrations(db)` that uses Drizzle's `migrate()` function to apply schema to the database. For server first-run: creates all tables (`teams`, `projects`, `test_runs`, `test_case_runs`, `failure_patterns`, `fix_history`, `notification_configs`). Uses Drizzle's push or migration approach (push for simplicity in initial release).
  - **Acceptance**: First run creates all tables. Subsequent runs are no-op.
  - **Complexity**: Medium

### P3.5 — Server Routes — Team Management (US2, US3)

- [X] T031 [US2] Implement team management routes at `packages/server/src/routes/teams.ts`
  - **Files**: `packages/server/src/routes/teams.ts`
  - **Details**: Fastify plugin exporting 4 routes: (1) `POST /api/teams` — no auth; validate `{ name }` with Zod (1-100 chars, `^[a-zA-Z0-9_-]+$`); generate API key; insert team with hashed key; return `{ team, apiKey, warning }` with 201 status; 409 on duplicate name. (2) `GET /api/teams` — auth required; return the authenticated team's info with project count and total runs. (3) `DELETE /api/teams/:id` — auth required; verify `:id` matches auth team; cascade delete team + all data; 403 if mismatch. (4) `POST /api/teams/:id/reset-key` — auth required; verify `:id` matches auth team; generate new key; update hash; return new raw key.
  - **Acceptance**: Full CRUD lifecycle works. Key is shown once on create/reset. Delete cascades. Auth enforced on all except POST create.
  - **Complexity**: Medium

- [X] T032 [P] [US2] Write unit tests for team routes
  - **Files**: `packages/server/tests/unit/routes/teams.test.ts`
  - **Details**: Use `fastify.inject()` for route testing against in-memory SQLite. Test: create team (success + duplicate conflict), get team info, reset key (old key invalid, new key works), delete team (own team OK, other team 403), validation errors on bad team name.
  - **Acceptance**: All tests pass.
  - **Complexity**: Medium

### P3.6 — Server Routes — Sync Endpoints (US1, US3)

- [X] T033 [US1] Implement sync service at `packages/server/src/services/sync-service.ts`
  - **Files**: `packages/server/src/services/sync-service.ts`
  - **Details**: Export `SyncService` class with methods: `processRunSync(teamId, payload: SyncRunsPayload)`: (1) Validate team name matches auth team; (2) Find-or-create project by `(teamId, payload.project)` — auto-registration per US3; (3) Insert run using `INSERT ... ON CONFLICT(id) DO NOTHING` for idempotency; (4) Insert all cases similarly; (5) If patterns included, process via `processPatternSync`; (6) Return `SyncRunsResponse` with status flags. `processPatternSync(teamId, projectId, patterns)`: For each pattern, find by `(teamId, signature)` — if exists, increment occurrences; if new, insert.
  - **Acceptance**: First sync creates project and stores data. Duplicate sync is no-op. Patterns deduplicated by signature.
  - **Complexity**: High

- [X] T034 [US1] Implement sync routes at `packages/server/src/routes/sync.ts`
  - **Files**: `packages/server/src/routes/sync.ts`
  - **Details**: Fastify plugin with 2 routes: (1) `POST /api/sync/runs` — auth required; validate body with Zod against `SyncRunsPayload` interface from sync-api.md; call `SyncService.processRunSync()`; return `SyncRunsResponse`. (2) `POST /api/sync/patterns` — auth required; validate `SyncPatternsPayload`; call `SyncService.processPatternSync()`; return response. Body size limit: 10MB. Handle 400 validation errors, 403 team mismatch, 503 database errors.
  - **Acceptance**: Sync endpoint stores data and returns correct response. Idempotent re-sync. Validation errors return 400. Team mismatch returns 403.
  - **Complexity**: Medium

- [X] T035 [P] [US1] Write unit tests for sync service and routes
  - **Files**: `packages/server/tests/unit/services/sync-service.test.ts`, `packages/server/tests/unit/routes/sync.test.ts`
  - **Details**: (1) `sync-service.test.ts`: process run sync (new project created, existing project reused), idempotent re-sync (run already exists → no-op), pattern dedup, team mismatch error. (2) `sync.test.ts`: `fastify.inject()` tests for both endpoints — success, validation error, auth error.
  - **Acceptance**: All tests pass. ≥85% coverage for sync service.
  - **Complexity**: Medium

### P3.7 — Server Routes — Query Endpoints (US5)

- [X] T036 [US5] Implement project listing route at `packages/server/src/routes/projects.ts`
  - **Files**: `packages/server/src/routes/projects.ts`
  - **Details**: Fastify plugin with routes: (1) `GET /api/projects` — auth required; query projects where `teamId` matches auth team; include summary stats (totalRuns, lastSyncAt, lastRunStatus, lastPassRate); support `limit` and `offset` query params; return paginated response per rest-api.md contract. (2) `GET /api/projects/:name` — auth required; return detailed project info including recentPassRate, totalFlakyTests, activeDevelopers; 404 if not found.
  - **Acceptance**: Returns team-scoped projects with stats. Pagination works. 404 for unknown project.
  - **Complexity**: Medium

- [X] T037 [US5] Implement run query routes at `packages/server/src/routes/runs.ts`
  - **Files**: `packages/server/src/routes/runs.ts`
  - **Details**: Fastify plugin with 3 routes: (1) `GET /api/runs` — auth required; query params: `project` (required), `limit`, `offset`, `status`, `days`; return paginated runs scoped to team; response per rest-api.md. (2) `GET /api/runs/:id` — auth required; return run detail with all cases and flaky analysis; verify run belongs to auth team; 404 if not found. (3) `GET /api/runs/compare` — auth required; query params: `run1`, `run2`; return comparison showing newFailures, fixed, consistent, newCases, removedCases.
  - **Acceptance**: Returns correct, team-scoped data. Pagination works. Compare identifies regressions and fixes.
  - **Complexity**: Medium

- [X] T038 [US5] Implement trend analysis routes at `packages/server/src/routes/trends.ts` and `packages/server/src/services/trend-service.ts`
  - **Files**: `packages/server/src/routes/trends.ts`, `packages/server/src/services/trend-service.ts`
  - **Details**: `trend-service.ts`: Reuse or adapt core trend calculation logic (from `packages/core/src/history/`) for server-scoped data. Calculate pass-rate, duration, flaky rankings, failure trends aggregated across team data. `trends.ts`: Fastify plugin with 4 routes per rest-api.md: `GET /api/trends/pass-rate`, `GET /api/trends/duration`, `GET /api/trends/flaky`, `GET /api/trends/failures`. All require `project` query param, scoped to auth team.
  - **Acceptance**: Trend data matches expected aggregation. Response format matches rest-api.md.
  - **Complexity**: Medium

- [X] T039 [US5] Implement diagnostics routes at `packages/server/src/routes/diagnostics.ts`
  - **Files**: `packages/server/src/routes/diagnostics.ts`
  - **Details**: Fastify plugin with routes: (1) `GET /api/patterns` — auth required; query params: `project` (optional), `category`, `source`, `limit`; return team-scoped patterns. (2) `GET /api/patterns/:id/fixes` — auth required; return fix history for pattern; verify pattern belongs to auth team.
  - **Acceptance**: Returns team-scoped patterns and fixes. Filtering works correctly.
  - **Complexity**: Low

- [X] T040 [US5] Implement health check route and register all routes in app factory
  - **Files**: `packages/server/src/routes/health.ts`, `packages/server/src/app.ts`
  - **Details**: `health.ts`: `GET /api/health` — no auth; returns `{ status: "ok", service: "argusai-server", version, uptime, database: "connected", timestamp }`. `app.ts`: Update `createServerApp()` to register all route plugins (health, teams, sync, projects, runs, trends, diagnostics), the auth hook (with public route exclusions), CORS plugin, and Swagger plugin. Configure Fastify body limit to 10MB for sync routes.
  - **Acceptance**: All routes accessible via correct paths. Health check returns 200 without auth. Swagger UI at `/api/docs`.
  - **Complexity**: Medium

---

## Phase 4 — Collaboration Features (US6, US7, US8)

**Goal**: Enterprise WeChat notifications, diagnostic pattern sync, and Dashboard standalone mode.

### P4.1 — Enterprise WeChat Notifications (US6)

- [X] T041 [US6] Define notification type system at `packages/server/src/notifications/types.ts`
  - **Files**: `packages/server/src/notifications/types.ts`
  - **Details**: Export interfaces: `NotificationChannel` with `send(message: NotificationMessage): Promise<void>`; `NotificationMessage` with `type: 'failure' | 'success' | 'digest' | 'newFlaky'`, `project: string`, `run: RunSummary`, `failedCases?: CaseSummary[]`, `dashboardUrl?: string`; `NotificationConfig` matching the `notification_configs` table columns. Export `NotificationTriggerType` enum.
  - **Acceptance**: TypeScript compiles. Types cover all notification scenarios from spec.
  - **Complexity**: Low

- [X] T042 [US6] Implement WeChat webhook sender at `packages/server/src/notifications/wecom.ts`
  - **Files**: `packages/server/src/notifications/wecom.ts`
  - **Details**: Class `WeComNotifier implements NotificationChannel`. `send(webhookUrl, message)`: POST to `webhookUrl` with `Content-Type: application/json`, body `{ msgtype: "markdown", markdown: { content: formatMessage(message) } }`. `formatMessage()`: generates Markdown with project name, run summary (pass/fail/skip/flaky counts), failed case names (max 10), flaky indicators, dashboard link. Rate limiting: track send timestamps, enforce max 18 msg/min per webhook URL. 10-second coalescing window for multiple syncs. Timeout: 5s. All errors caught and logged — never throws.
  - **Acceptance**: Sends correctly formatted Markdown to webhook. Rate limiting prevents exceeding 20/min. Timeout/error doesn't propagate.
  - **Complexity**: Medium

- [X] T043 [US6] Implement notification trigger engine at `packages/server/src/notifications/trigger.ts`
  - **Files**: `packages/server/src/notifications/trigger.ts`
  - **Details**: Class `NotificationTrigger`. Method `evaluateAndSend(teamId, run, cases, config: NotificationConfig)`: (1) If `config.onFailure && run.status === 'failed'` → send failure notification; (2) If `config.onSuccess && run.status === 'passed'` → send success notification; (3) If `config.onNewFlaky` → check if any case newly crossed the FLAKY threshold (compare with previous runs) → send flaky alert. Method `sendDailyDigest(teamId, config)`: aggregate last 24h stats → send digest. This is called from the sync route after successful data storage.
  - **Acceptance**: Correct trigger evaluation for each notification type. Digest aggregates correctly. Non-blocking — errors logged only.
  - **Complexity**: Medium

- [X] T044 [US6] Implement notification config API routes at `packages/server/src/routes/notifications.ts`
  - **Files**: `packages/server/src/routes/notifications.ts`
  - **Details**: Add to `teams.ts` or new file: (1) `GET /api/teams/:id/notifications` — auth required; return notification config for team; 404 if no config. (2) `PUT /api/teams/:id/notifications` — auth required; validate body with Zod (webhookUrl: URL, onFailure: boolean, etc.); upsert config; return updated config. Verify `:id` matches auth team.
  - **Acceptance**: Get/put config works. Webhook URL validation. Only own team's config accessible.
  - **Complexity**: Low

- [X] T045 [US6] Integrate notification trigger into sync route
  - **Files**: `packages/server/src/routes/sync.ts`, `packages/server/src/services/sync-service.ts`
  - **Details**: After successful run sync in `processRunSync()`: (1) Load team's notification config; (2) If webhook configured, call `NotificationTrigger.evaluateAndSend()` asynchronously (don't await — fire and forget); (3) Include triggered notification types in sync response `notificationsTriggered[]` array.
  - **Acceptance**: Syncing a failed run with webhook configured triggers notification. Notification is async — sync response is not delayed.
  - **Complexity**: Low

- [X] T046 [P] [US6] Write unit tests for notification system
  - **Files**: `packages/server/tests/unit/notifications/wecom.test.ts`, `packages/server/tests/unit/notifications/trigger.test.ts`
  - **Details**: (1) `wecom.test.ts`: Mock fetch — verify correct URL, headers, Markdown body format; rate limiting (19th message within 1 min is delayed); error handling (network failure logged, not thrown); timeout. (2) `trigger.test.ts`: failure trigger fires, success trigger fires, trigger disabled → no call, newFlaky detection, daily digest aggregation.
  - **Acceptance**: All tests pass. ≥80% coverage for notifications.
  - **Complexity**: Medium

### P4.2 — Diagnostic Pattern Sync (US7)

- [X] T047 [US7] Extend `RemoteHistoryStore` and knowledge store to sync diagnostic patterns
  - **Files**: `packages/core/src/sync/remote-history-store.ts`, `packages/core/src/knowledge/knowledge-store.ts`
  - **Details**: Option A: Create a `RemoteKnowledgeStore` decorator (similar pattern to `RemoteHistoryStore`) that wraps `DrizzleKnowledgeStore` and enqueues pattern/fix sync. Option B: Extend `RemoteHistoryStore.saveRun()` to include patterns discovered during the run in the sync payload (patterns are passed alongside run data). Use Option B as it matches the sync-api.md contract where patterns are optional in the `SyncRunsPayload`. Update `saveRun` to accept an optional `patterns` parameter and include them in the sync payload.
  - **Acceptance**: Patterns discovered during a test run are included in the sync payload. Server receives and deduplicates them.
  - **Complexity**: Medium

- [X] T048 [P] [US7] Write unit tests for diagnostic sync
  - **Files**: `packages/core/tests/unit/sync/diagnostic-sync.test.ts`
  - **Details**: Test that `RemoteHistoryStore.saveRun()` with patterns enqueues a payload containing the patterns array. Test server-side dedup: same signature from same team → occurrence count incremented, not duplicated.
  - **Acceptance**: All tests pass.
  - **Complexity**: Low

### P4.3 — Dashboard Standalone Mode (US8)

- [X] T049 [US8] Create API client with auth support at `packages/dashboard/ui/src/api/client.ts`
  - **Files**: `packages/dashboard/ui/src/api/client.ts`
  - **Details**: Export `ApiClient` class or module. Constructor takes `baseUrl` (from `VITE_API_BASE_URL` or default `/api`). All methods add `X-API-Key` header from `localStorage.getItem('argusai-api-key')`. Methods mirror REST API: `getProjects()`, `getRuns(project, options)`, `getRunById(id)`, `compareRuns(run1, run2)`, `getTrends(type, project, options)`, `getPatterns(project)`, `getTeam()`, `updateNotifications(config)`. Handle 401 response by clearing stored key and redirecting to login.
  - **Acceptance**: API calls include correct auth header. 401 triggers login redirect.
  - **Complexity**: Medium

- [X] T050 [US8] Implement `LoginScreen.tsx` component
  - **Files**: `packages/dashboard/ui/src/components/LoginScreen.tsx`
  - **Details**: Full-page login screen. Input field for API key (masked). "Connect" button. On submit: store key in localStorage, call `getTeam()` to validate, on success navigate to project list, on 401 show error. Styling: Tailwind CSS, consistent with existing Dashboard theme.
  - **Acceptance**: Valid key → navigates to projects. Invalid key → shows error. Key persisted across page refresh.
  - **Complexity**: Low

- [X] T051 [US8] Implement `TeamSelector.tsx` component
  - **Files**: `packages/dashboard/ui/src/components/TeamSelector.tsx`
  - **Details**: Dropdown component in the Dashboard header. Shows current team name. Allows switching between teams if user has stored multiple API keys (stored as array in localStorage). On switch: update active API key, refresh data. Show team name and API key prefix for identification.
  - **Acceptance**: Shows current team. Switch updates all data. Multiple teams supported.
  - **Complexity**: Low

- [X] T052 [US8] Implement `ProjectList.tsx` component
  - **Files**: `packages/dashboard/ui/src/components/ProjectList.tsx`
  - **Details**: Grid layout of project cards. Each card shows: project name, total runs, last sync time, last pass rate (with color coding), status indicator. Click navigates to project detail (existing Dashboard views). Empty state: "No projects yet" with instructions for configuring sync. Uses `ApiClient.getProjects()` for data fetching.
  - **Acceptance**: Displays all team projects. Click navigates to project. Empty state shown when no projects.
  - **Complexity**: Medium

- [X] T053 [US8] Adapt existing Dashboard pages for server data source
  - **Files**: `packages/dashboard/ui/src/pages/` (multiple existing files), `packages/dashboard/server/index.ts`
  - **Details**: (1) Add a React Context `DataSourceContext` with `mode: 'local' | 'server'` and the `ApiClient` instance. (2) Update existing pages (TrendsPage, RunsPage, etc.) to use `DataSourceContext` — when `mode === 'server'`, fetch from `ApiClient` instead of local backend API. Response formats are designed to be identical per rest-api.md. (3) Add "synced by" column to RunsPage when in server mode. (4) Update Dashboard Fastify backend `server/index.ts` to support a "standalone" mode where it serves only the static frontend (API calls go directly to ArgusAI Server via CORS).
  - **Acceptance**: Dashboard works in both local and server mode. Server mode shows team-scoped data. "Synced by" column visible.
  - **Complexity**: High

- [X] T054 [US8] Update Dashboard build configuration for standalone mode
  - **Files**: `packages/dashboard/vite.config.ts`, `packages/dashboard/package.json`
  - **Details**: Add `VITE_API_BASE_URL` and `VITE_AUTH_REQUIRED` environment variable support to Vite config. When `VITE_AUTH_REQUIRED=true`: LoginScreen shown on app load, TeamSelector visible. When false (default): current local behavior preserved. Add `build:standalone` script to `package.json` that builds with server mode env vars.
  - **Acceptance**: `pnpm --filter argusai-dashboard build` → local mode. `pnpm --filter argusai-dashboard build:standalone` → standalone mode with auth.
  - **Complexity**: Low

- [X] T055 [P] [US8] Write unit tests for Dashboard server components
  - **Files**: `packages/dashboard/ui/src/__tests__/LoginScreen.test.tsx`, `packages/dashboard/ui/src/__tests__/ProjectList.test.tsx`
  - **Details**: (1) `LoginScreen.test.tsx`: render, enter key, submit → success (mock API), submit → failure (401), key stored in localStorage. (2) `ProjectList.test.tsx`: render with mock projects, empty state, click navigation.
  - **Acceptance**: All tests pass.
  - **Complexity**: Low

---

## Phase 5 — Deployment & Polish (US9)

**Goal**: Docker deployment artifacts, documentation, OpenAPI spec, and final integration testing.

- [X] T056 [US9] Create `Dockerfile` for the server package
  - **Files**: `packages/server/Dockerfile`
  - **Details**: Multi-stage build: (1) Builder stage: `node:20-alpine`, install pnpm, copy monorepo, `pnpm install --frozen-lockfile`, `pnpm --filter argusai-server build`. (2) Runtime stage: `node:20-alpine`, copy built output + `node_modules` (production only). Set `NODE_ENV=production`. Expose port 3000. `HEALTHCHECK` using `wget` to `/api/health`. `CMD ["node", "dist/index.js"]`. Target: <200MB image.
  - **Acceptance**: `docker build` succeeds. Image size <200MB. Container starts and responds to health check.
  - **Complexity**: Medium

- [X] T057 [US9] Create `docker-compose.yml` with server + PostgreSQL + dashboard
  - **Files**: `packages/server/docker-compose.yml`
  - **Details**: Three services: (1) `postgres`: `postgres:16-alpine`, volume for data persistence, environment vars for user/password/db. (2) `argusai-server`: builds from Dockerfile, depends_on postgres, environment vars: `DATABASE_URL`, `DATABASE_DIALECT=pg`, `PORT=3000`. Port 3000 exposed. (3) `dashboard` (optional, profiles: ['full']): builds from dashboard Dockerfile, environment `VITE_API_BASE_URL=http://argusai-server:3000/api`, `VITE_AUTH_REQUIRED=true`. Port 5173 exposed. Named volume for postgres data. Network shared.
  - **Acceptance**: `docker-compose up` starts all services. Server connects to postgres. Dashboard connects to server.
  - **Complexity**: Medium

- [X] T058 [P] [US9] Create quickstart documentation
  - **Files**: `specs/007-server/quickstart.md`
  - **Details**: Step-by-step guide covering: (1) Server deployment via `docker-compose up`; (2) Creating a team and getting API key; (3) Configuring local `e2e.yaml` with `server` section; (4) Running first test and verifying sync; (5) Accessing Dashboard; (6) Configuring 企微 notifications. Include example `e2e.yaml` snippets and curl commands.
  - **Acceptance**: A developer can follow the guide to set up server sync in under 5 minutes.
  - **Complexity**: Low

- [X] T059 [P] [US9] Create migration guide for existing users
  - **Files**: `specs/007-server/migration-guide.md`
  - **Details**: Guide covering: (1) What changes in the upgrade (Drizzle ORM replaces direct SQLite); (2) Local data preservation guarantee; (3) How to add `server` section to existing `e2e.yaml`; (4) Database migration v3 auto-upgrade behavior; (5) Troubleshooting: what if migration fails, manual migration command, rollback steps.
  - **Acceptance**: Existing users have clear upgrade path with no data loss.
  - **Complexity**: Low

- [X] T060 [US9] Add OpenAPI specification auto-generation via `@fastify/swagger`
  - **Files**: `packages/server/src/app.ts`
  - **Details**: Configure `@fastify/swagger` in `createServerApp()` to auto-generate OpenAPI spec from Fastify route schemas. Add Zod-to-JSON-Schema integration (`fastify-type-provider-zod`). Register `@fastify/swagger-ui` at `/api/docs`. Ensure all routes have proper Fastify schema definitions for request/response validation and documentation.
  - **Acceptance**: `/api/docs` serves Swagger UI. All endpoints documented with request/response schemas.
  - **Complexity**: Medium

- [X] T061 Write integration test: end-to-end sync flow
  - **Files**: `packages/server/tests/integration/sync-flow.test.ts`
  - **Details**: Full integration test: (1) Start Fastify server with in-memory SQLite; (2) Create a team via API; (3) Configure a mock local instance with the API key; (4) Simulate a test run with `RemoteHistoryStore.saveRun()`; (5) Process sync queue via `SyncManager.syncNow()`; (6) Verify run appears on server via `GET /api/runs`; (7) Verify project was auto-registered via `GET /api/projects`; (8) Verify trends compute correctly via `GET /api/trends/pass-rate`; (9) Test idempotent re-sync (no duplicates). (10) Test graceful degradation: stop server, save another run locally, verify local data intact, restart server, sync, verify queued data delivered.
  - **Acceptance**: Full flow works end-to-end. All assertions pass. Graceful degradation verified.
  - **Complexity**: High

- [X] T062 Update `packages/core/src/index.ts` barrel exports to include new modules
  - **Files**: `packages/core/src/index.ts`
  - **Details**: Re-export from `./db/index.js` and `./sync/index.js`. Export new types: `ServerConfig`, `SyncQueue`, `SyncClient`, `SyncManager`, `RemoteHistoryStore`, `DrizzleHistoryStore`, `DrizzleKnowledgeStore`, `DbConfig`.
  - **Acceptance**: Consumers can import all new modules from `argusai-core`.
  - **Complexity**: Low

---

## Dependency Graph

```
Phase 1 (Setup)
  T001 ─────┐
  T002 ─────┤
  T003 [P] ─┤
  T004 [P] ─┤ All must complete before Phase 2/3
  T005 [P] ─┘

Phase 2 (Drizzle ORM) — MUST complete before Phase 3
  T006 ──┬──▶ T009 ──▶ T010 ──┬──▶ T014 ──▶ T023 (Phase 3)
  T007 ──┤                     │
  T008 ──┘                     ├──▶ T011 ──▶ T015
         T013 ─────────────────┘
         T012 (parallel, no deps)
         T016 (after T010, T011, T013)

Phase 3 (Sync + Server API)
  T017 ──▶ T019 ──▶ T021 ──▶ T022 ──▶ T023
           T020 ──┘
  T026 ──▶ T027 ──▶ T031 ──▶ T033 ──▶ T034
  T029 ──▶ T030 ──▶ T040 (registers all routes)
  T036, T037, T038, T039 (parallel, depend on T030 + T027)

Phase 4 (Collaboration) — depends on Phase 3
  T041 ──▶ T042 ──▶ T043 ──▶ T045
  T044 (parallel with T042-T043)
  T047 (depends on T022)
  T049 ──▶ T050 ──▶ T052 ──▶ T053
  T051 (parallel with T050)
  T054 (parallel with T053)

Phase 5 (Deployment) — depends on Phase 3+4
  T056 ──▶ T057
  T058, T059 (parallel, no code deps)
  T060 (depends on T040)
  T061 (depends on all route + sync tasks)
  T062 (after Phase 2+3)
```

---

## Parallel Execution Opportunities

### Within Phase 2 (Drizzle ORM)
- **T006, T007, T008** can be developed in parallel (three schema files, independent)
- **T010, T011** can be developed in parallel after T009 (two store implementations)

### Within Phase 3 (Sync + Server)
- **T017 (config extension)** and **T026 (auth system)** and **T029 (server DB)** are independent entry points
- **T036, T037, T038, T039** (query routes) can all be developed in parallel once T027 + T030 are complete
- **T025, T028, T032, T035** (test tasks) can be parallelized with subsequent implementation tasks

### Within Phase 4 (Collaboration)
- **T041-T046** (notifications) and **T049-T055** (Dashboard) can be developed in parallel by different developers
- **T047** (diagnostic sync) is independent of both notification and Dashboard tracks

### Cross-Phase
- Phase 4 notification track can start as soon as Phase 3 P3.5 (team routes) is done
- Phase 4 Dashboard track can start as soon as Phase 3 P3.7 (query routes) is done
- Phase 5 docs (T058, T059) can start at any time

---

## Implementation Strategy

### MVP Scope (Recommended)
**Phase 1 + Phase 2 + Phase 3 = MVP**
- Drizzle ORM migration (local behavior unchanged)
- Sync pipeline (local → server)
- Full REST API with auth
- Team/project management with auto-registration
- Graceful degradation

This delivers US1, US2, US3, US4, US5, US10 — all P1 user stories.

### Incremental Delivery
1. **Week 1**: Phase 1 (Setup) + Phase 2 (Drizzle ORM) — 7-8 days
2. **Week 2-3**: Phase 3 (Sync + Server API) — 10-12 days
3. **Week 3-4**: Phase 4 (Collaboration) — 6-8 days
4. **Week 4**: Phase 5 (Deployment + Polish) — 3-4 days

### Risk Mitigation Checkpoints
- After T016: Verify all existing tests pass with Drizzle stores (zero regression gate)
- After T025: Verify sync queue reliability under failure scenarios
- After T040: Verify all API endpoints match rest-api.md contracts
- After T061: Full end-to-end integration verified

---

## Format Validation

✅ All 62 tasks follow the required checklist format: `- [ ] [TaskID] [P?] [Story?] Description`  
✅ Task IDs are sequential (T001–T062)  
✅ `[P]` markers on parallelizable tasks  
✅ `[US*]` labels on all user story phase tasks  
✅ Setup/foundational phases have no story labels  
✅ Every task has file paths, details, and acceptance criteria  
✅ Complexity rated for each task  
