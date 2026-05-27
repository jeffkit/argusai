# Technical Research: ArgusAI Server Platformization

**Feature**: 007-server  
**Date**: 2026-03-09  
**Status**: Complete

---

## Decision 1: Drizzle ORM Multi-Dialect Strategy

### Context

The current codebase uses `better-sqlite3` directly with raw SQL in `SQLiteHistoryStore` and `SQLiteKnowledgeStore`. The spec requires transparent support for SQLite (local), MySQL (server), and PostgreSQL (server) using Drizzle ORM.

### Key Finding

Drizzle ORM uses **dialect-specific schema builders**: `sqliteTable()`, `pgTable()`, `mysqlTable()`. There is no single "universal table" function. This means schema definitions must be written per-dialect.

### Decision: Dialect-Specific Schema Files with Shared Store Interface

Maintain separate schema definition files for each dialect, but use a **unified store implementation** that leverages Drizzle's consistent query API.

```
packages/core/src/db/
├── schema-sqlite.ts      # sqliteTable() definitions
├── schema-pg.ts          # pgTable() definitions
├── schema-mysql.ts       # mysqlTable() definitions
├── create-db.ts          # Factory: picks driver + schema based on config
├── drizzle-history-store.ts   # Shared HistoryStore impl using Drizzle API
└── drizzle-knowledge-store.ts # Shared KnowledgeStore impl using Drizzle API
```

**Rationale**: The query builder API (`db.select().from(table).where(...)`) is identical across dialects. Only the schema definition and driver initialization differ. This gives us:
- Type-safe schema definitions per dialect (leveraging dialect-specific column types like `integer` vs `serial`)
- A single store implementation that works with any Drizzle instance
- Zero runtime dialect detection in business logic

**Alternatives considered**:
1. *Single schema with runtime adapter* — Not supported by Drizzle; each dialect has its own import path.
2. *Code-gen from shared spec* — Over-engineering; manual maintenance of 3 schema files is acceptable given the small number of tables (5-6).
3. *Kysely instead of Drizzle* — Kysely supports multi-dialect better but lacks Drizzle's migration tooling and growing ecosystem. Constitution already lists Drizzle as the direction.

**Trade-offs**:
- Pro: Full type safety per dialect, access to dialect-specific features (e.g., PostgreSQL `uuid` type)
- Pro: Drizzle-kit can generate proper migrations per dialect
- Con: Schema changes require updating 3 files (mitigated by code review and tests)
- Con: ~150 extra lines of schema code (acceptable)

### Migration from better-sqlite3

Strategy for zero-downtime migration of existing SQLite data:

1. **Schema introspection**: Use `drizzle-kit pull` against existing `.argusai/history.db` to verify schema compatibility
2. **Drizzle schema files match existing tables**: The new `schema-sqlite.ts` must define tables with identical column names, types, and constraints as the current `migrations.ts`
3. **Migration version bridging**: The current `user_version` pragma (currently at version 2) will be respected. Drizzle migrations start from version 3+, with a compatibility migration that:
   - Detects `user_version >= 2` → skips table creation (tables already exist)
   - Adds any new columns (e.g., `team_id`, `synced_at`) as `ALTER TABLE ... ADD COLUMN`
4. **Rollback safety**: `better-sqlite3` direct usage remains available as fallback during transition

**Risk**: `datetime('now')` default values in SQLite vs `NOW()` in PostgreSQL — handled by dialect-specific schema defaults.

---

## Decision 2: Sync Queue Architecture

### Context

The sync queue buffers local test results when the server is unreachable and retries delivery. The spec explicitly requires simplicity ("not a full message queue").

### Decision: SQLite-Based Sync Queue Table

Add a `sync_queue` table to the existing local SQLite database (`.argusai/history.db`).

```sql
CREATE TABLE sync_queue (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,          -- JSON-serialized sync payload
  type       TEXT NOT NULL,          -- 'run' | 'patterns'
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sending' | 'failed'
  attempts   INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  next_retry_at TEXT NOT NULL,       -- ISO datetime for backoff scheduling
  last_error TEXT
);
```

**Rationale**:
- Reuses existing SQLite database — no new file or dependency
- Survives process restarts (persisted)
- Simple SELECT/UPDATE queries for queue management
- Atomic with test result writes (same transaction can save run + enqueue sync)

**Alternatives considered**:
1. *File-based queue (JSON files in `.argusai/sync-queue/`)* — More filesystem I/O, no transactional guarantee with history writes, harder to manage ordering.
2. *In-memory queue with periodic flush* — Loses data on crash.
3. *Redis/RabbitMQ* — Overkill for a local-first tool; adds deployment dependency.

**Retry strategy**:
- Exponential backoff: 5s → 10s → 20s → 40s → ... → max 5 minutes
- Max 10 retries per payload
- Background timer checks queue every 30 seconds
- On server recovery, sends in chronological order (ORDER BY created_at ASC)

**Trade-offs**:
- Pro: Zero new dependencies, transactional with history writes
- Pro: Survives any crash scenario
- Con: SQLite file lock contention if sync timer and test runner write simultaneously (mitigated by WAL mode already configured)

---

## Decision 3: RemoteHistoryStore Design

### Context

Need a new `HistoryStore` implementation that writes locally AND enqueues async sync to the server. Must implement the existing `HistoryStore` interface without changes.

### Decision: Decorator Pattern — RemoteHistoryStore wraps DrizzleHistoryStore

```typescript
class RemoteHistoryStore implements HistoryStore {
  constructor(
    private local: HistoryStore,       // DrizzleHistoryStore (SQLite)
    private syncQueue: SyncQueue,      // Enqueues payloads for server delivery
    private serverConfig: ServerConfig // URL, API key, team
  ) {}

  saveRun(run, cases) {
    this.local.saveRun(run, cases);      // Write locally first (sync, blocking)
    this.syncQueue.enqueue('run', { run, cases }); // Enqueue for async sync (non-blocking)
  }

  // All read methods delegate to local store
  getRuns(...) { return this.local.getRuns(...); }
  // ...
}
```

**Rationale**:
- Preserves the local-first guarantee: local write always succeeds
- Implements existing `HistoryStore` interface — zero changes needed in callers
- Sync is fire-and-forget from the caller's perspective
- `createHistoryStore()` factory gains a new branch: if `serverConfig` is present, wrap local store with `RemoteHistoryStore`

**Alternatives considered**:
1. *Separate sync service watching for new rows* — Polling-based, misses the opportunity for transactional enqueue.
2. *Event-based sync (emit event on saveRun)* — More coupling, harder to guarantee delivery.

---

## Decision 4: Server Authentication Model

### Context

API key per team. Need to balance security with simplicity for a self-hosted tool.

### Decision: API Key in Header with SHA-256 Hashing

- **Header**: `X-API-Key: <raw-key>` (simpler than `Authorization: Bearer` for machine-to-machine)
- **Storage**: Only the SHA-256 hash of the API key is stored in the database
- **Generation**: `crypto.randomBytes(32).toString('hex')` → 64-character hex string
- **Validation**: Hash incoming key, compare with stored hash

```typescript
// Key generation
const rawKey = crypto.randomBytes(32).toString('hex');
const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');
// Store hashedKey in DB; return rawKey to user ONCE

// Validation (Fastify preHandler hook)
const incoming = request.headers['x-api-key'];
const hashed = crypto.createHash('sha256').update(incoming).digest('hex');
const team = await db.select().from(teams).where(eq(teams.apiKeyHash, hashed));
```

**Rationale**:
- Simple and standard for API key auth
- Hash storage means database leak doesn't expose keys
- Fastify preHandler hook makes auth transparent to route handlers
- No JWT complexity needed at this stage (spec mentions JWT as future option for Dashboard)

**Alternatives considered**:
1. *JWT tokens* — More complex, requires token refresh logic. Suitable for Dashboard auth later but overkill for M2M API key auth.
2. *OAuth2* — Way too complex for a self-hosted tool.
3. *Plain text key storage* — Security risk; hashing adds negligible overhead.

---

## Decision 5: Server Package Architecture

### Context

New `packages/server/` package in the monorepo. Must follow existing conventions.

### Decision: Fastify Server with Plugin Architecture

```
packages/server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point + server startup
│   ├── app.ts                # Fastify app factory (createServerApp)
│   ├── config.ts             # Server config schema (Zod)
│   ├── db/
│   │   ├── connection.ts     # DB connection factory
│   │   └── migrate.ts        # Drizzle migration runner
│   ├── auth/
│   │   ├── api-key.ts        # Key generation, hashing, validation
│   │   └── auth-hook.ts      # Fastify preHandler hook
│   ├── routes/
│   │   ├── sync.ts           # POST /api/sync/runs, /api/sync/patterns
│   │   ├── teams.ts          # Team CRUD + key management
│   │   ├── projects.ts       # Project listing + stats
│   │   ├── runs.ts           # Run queries, detail, comparison
│   │   ├── trends.ts         # Trend analysis endpoints
│   │   ├── diagnostics.ts    # Diagnostic patterns + fixes
│   │   └── health.ts         # Health check endpoint
│   ├── notifications/
│   │   ├── types.ts          # Notification config types
│   │   ├── wecom.ts          # 企微 webhook sender
│   │   └── trigger.ts        # Notification trigger engine
│   └── services/
│       ├── sync-service.ts   # Process incoming sync data
│       ├── trend-service.ts  # Reuse core trend calculations
│       └── flaky-service.ts  # Reuse core FlakyDetector
├── Dockerfile
├── docker-compose.yml
└── tests/
    └── ... (Vitest tests)
```

**Rationale**:
- Follows existing monorepo conventions (TypeScript strict, ESM, pnpm, Vitest)
- Fastify 5.x as per constitution
- Plugin architecture allows independent testing of each route module
- Reuses core logic (FlakyDetector, trend calculations) by depending on `argusai-core`
- Clean separation of concerns (auth, routes, services, notifications)

---

## Decision 6: 企微 Notification Implementation

### Context

Direct webhook calls to 企微 group bot API. Must handle rate limits (20 msg/min) and not block data sync.

### Decision: Async Notification Queue with Rate Limiting

```typescript
class WeComNotifier {
  private queue: NotificationPayload[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly RATE_LIMIT = 20;     // per minute
  private readonly SEND_INTERVAL = 3500; // ~17/min, safely under limit
  
  async send(webhookUrl: string, payload: WeComMessage): Promise<void> {
    // POST to https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
    // Content-Type: application/json
    // msgtype: "markdown" for rich formatting
  }
}
```

**Message format** (Markdown):
```markdown
## ❌ ArgusAI 测试失败通知

**项目**: payment-service
**运行时间**: 2026-03-09 14:30:00
**触发**: cli (developer-a)

### 结果摘要
- ✅ 通过: 18
- ❌ 失败: 3
- ⏭️ 跳过: 1
- 🔄 Flaky: 2

### 失败用例
1. `health-check` — Connection refused
2. `payment-flow` — Assertion: expected 200, got 500
3. `auth-token` — Timeout after 30s

[📊 查看 Dashboard](https://argusai.example.com/projects/payment-service/runs/abc123)
```

**Rate limiting strategy**:
- Coalesce notifications from multiple syncs within a 10-second window
- If > 15 notifications/minute, switch to digest mode
- Failed webhook calls are logged but NOT retried (per spec: no-op on failure)

---

## Decision 7: Dashboard Standalone Mode

### Context

The existing Dashboard (`packages/dashboard/`) runs embedded with a local project. For server mode, it needs to connect to the remote ArgusAI Server API instead.

### Decision: Environment-Based API Routing

The Dashboard already uses a Fastify backend that proxies requests. For standalone mode:

1. **Build-time configuration**: `VITE_API_BASE_URL` environment variable
   - Local mode (default): `/api` (relative, proxied by Fastify backend)
   - Standalone mode: `https://argusai-server.example.com/api` (direct)

2. **Runtime API client**: A thin wrapper that:
   - Adds `X-API-Key` header from config/localStorage
   - Handles 401 responses (prompt for new key)
   - Supports team switching (update API key)

3. **Shared React components**: All existing visualization components (TrendsPage, charts, flaky tables) remain unchanged. Only the data-fetching layer changes.

4. **No separate Dashboard package needed**: The existing `packages/dashboard/` can serve both modes. The Fastify backend gains a "server-proxy" mode where it proxies to the ArgusAI Server instead of reading local data.

**Rationale**:
- Minimal code changes to existing Dashboard
- React components are data-source agnostic (they receive data via props/hooks)
- Single codebase for both modes reduces maintenance burden

**New Dashboard UI additions**:
- Login/API key entry screen
- Team selector dropdown
- Project list (multi-project navigation)
- "Synced by" column in run history

---

## Decision 8: e2e.yaml Server Configuration Extension

### Context

Need to extend `e2e.yaml` with optional `server` section.

### Decision: Minimal Required Fields with Sensible Defaults

```yaml
# e2e.yaml (extended)
server:
  url: "https://argusai-server.example.com"
  apiKey: "${ARGUSAI_API_KEY}"  # Supports env var substitution
  team: "payment-team"
  sync: auto    # auto | manual | disabled (default: auto)
```

Zod schema addition to `E2EConfigSchema`:

```typescript
const ServerConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
  team: z.string().min(1),
  sync: z.enum(['auto', 'manual', 'disabled']).default('auto'),
}).optional();
```

**Rationale**:
- `optional()` at the top level means omitting `server` entirely is valid (preserves current behavior)
- Environment variable substitution already works via `variable-resolver.ts`
- `ARGUSAI_API_KEY` env var takes precedence (checked in sync code, not schema)
- Team name is required to catch misconfiguration early

---

## Decision 9: Idempotent Sync Protocol

### Context

The same run may be synced multiple times (retries, manual re-sync). Must not create duplicates.

### Decision: Upsert on Run ID

The server's sync endpoint uses `INSERT ... ON CONFLICT (id) DO NOTHING` for test runs and cases. The run `id` (UUID generated locally) is the natural dedup key.

```sql
-- PostgreSQL / SQLite
INSERT INTO test_runs (id, team_id, project_id, ...) 
VALUES (?, ?, ?, ...) 
ON CONFLICT (id) DO NOTHING;
```

The response includes a `status` field indicating `created` or `already_exists` for each run, allowing the client to track what was new.

**Rationale**:
- Simple, database-native dedup
- No application-level locking needed
- Works atomically within a transaction

---

## Decision 10: Server Database Selection Guide

### Context

The server supports MySQL and PostgreSQL. Need guidance for operators.

### Decision: PostgreSQL as Default Recommendation

- **PostgreSQL**: Recommended for all deployments. Better JSON support, better concurrent write performance, richer window functions for trend queries.
- **MySQL**: Supported for teams already running MySQL infrastructure.
- **SQLite**: Supported for small-team/evaluation deployments (< 5 developers, < 1000 runs/month).

The `docker-compose.yml` will ship with PostgreSQL as the default.

**Rationale**: PostgreSQL's JSON operators, window functions, and concurrent write handling make it the best fit for the server's workload (many writes from sync, complex reads for trends).
