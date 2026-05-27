# Sync API Contract: ArgusAI Local → Server

**Feature**: 007-server  
**Date**: 2026-03-09

---

## Overview

The sync protocol defines how local ArgusAI instances push test results and diagnostic data to the central server. The design priorities are:

1. **Idempotent** — Re-syncing the same data produces no duplicates
2. **Non-blocking** — Sync never blocks local test execution
3. **Resilient** — Failed syncs are queued and retried automatically
4. **Minimal** — Only the data needed for server features is transmitted

---

## Configuration

### e2e.yaml Extension

```yaml
server:
  url: "https://argusai-server.example.com"
  apiKey: "${ARGUSAI_API_KEY}"
  team: "payment-team"
  sync: auto  # auto | manual | disabled
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| url | string (URL) | yes | — | ArgusAI Server base URL |
| apiKey | string | yes | — | Team API key (supports `${ENV_VAR}` substitution) |
| team | string | yes | — | Team name (must match API key's team) |
| sync | enum | no | `auto` | Sync mode |

### Environment Variable Override

`ARGUSAI_API_KEY` environment variable takes precedence over `server.apiKey` in `e2e.yaml`.

### Sync Modes

| Mode | Behavior |
|------|----------|
| `auto` | Sync runs automatically after each test execution |
| `manual` | Results stored locally; sync only on explicit `argusai sync` command |
| `disabled` | No sync — equivalent to no `server` section |

---

## Sync Endpoints

### POST /api/sync/runs

**Auth**: Required (`X-API-Key` header)  
**Description**: Receive test run data from a local instance. Auto-registers the project if new.  
**Content-Type**: `application/json`  
**Max Body Size**: 10 MB

#### Request Payload

```typescript
interface SyncRunsPayload {
  /** Project name from e2e.yaml */
  project: string;
  /** Team name (validated against API key) */
  team: string;
  /** Developer identifier (hostname or git user) */
  sourceDeveloper?: string;
  /** The test run record */
  run: {
    id: string;               // UUID generated locally
    timestamp: number;         // Epoch milliseconds
    gitCommit: string | null;
    gitBranch: string | null;
    configHash: string;
    trigger: 'cli' | 'mcp' | 'dashboard' | 'ci';
    duration: number;          // ms
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    status: 'passed' | 'failed';
  };
  /** All test case results for this run */
  cases: Array<{
    id: string;                // UUID generated locally
    suiteId: string;
    caseName: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;          // ms
    attempts: number;
    responseMs: number | null;
    assertions: number | null;
    error: string | null;      // Truncated to 2000 chars
    snapshot: string | null;   // Optional diagnostic snapshot
  }>;
  /** Optional: diagnostic patterns discovered during this run */
  patterns?: Array<{
    category: string;
    signature: string;
    signaturePattern: string;
    description: string;
    suggestedFix: string;
    confidence: number;
    source: 'built-in' | 'learned';
  }>;
}
```

#### Example Request

```json
{
  "project": "payment-service",
  "team": "payment-team",
  "sourceDeveloper": "developer-a@macbook",
  "run": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1741523400000,
    "gitCommit": "abc123def",
    "gitBranch": "main",
    "configHash": "sha256:abcdef...",
    "trigger": "cli",
    "duration": 45000,
    "passed": 18,
    "failed": 2,
    "skipped": 1,
    "flaky": 1,
    "status": "failed"
  },
  "cases": [
    {
      "id": "case-uuid-1",
      "suiteId": "api-tests",
      "caseName": "health-check",
      "status": "passed",
      "duration": 1200,
      "attempts": 1,
      "responseMs": 45,
      "assertions": 3,
      "error": null,
      "snapshot": null
    },
    {
      "id": "case-uuid-2",
      "suiteId": "api-tests",
      "caseName": "payment-flow",
      "status": "failed",
      "duration": 30000,
      "attempts": 2,
      "responseMs": null,
      "assertions": 5,
      "error": "Expected status 200, got 500",
      "snapshot": "{\"containerLogs\": [...]}"
    }
  ],
  "patterns": [
    {
      "category": "HTTP_ERROR",
      "signature": "learned::GET /api/pay 500",
      "signaturePattern": "GET /api/pay 5\\d{2}",
      "description": "Payment API returning 500",
      "suggestedFix": "Check database connection",
      "confidence": 0.7,
      "source": "learned"
    }
  ]
}
```

#### Response — Success

**Status**: `200 OK`

```json
{
  "success": true,
  "result": {
    "runStatus": "created",
    "projectStatus": "existing",
    "casesStored": 20,
    "patternsStored": 1,
    "patternsDeduped": 0,
    "notificationsTriggered": ["failure"]
  }
}
```

| Field | Values | Description |
|-------|--------|-------------|
| runStatus | `created` / `already_exists` | Whether this run ID was new |
| projectStatus | `created` / `existing` | Whether the project was auto-registered |
| casesStored | number | Number of case records stored |
| patternsStored | number | New patterns created |
| patternsDeduped | number | Patterns matched to existing (occurrence incremented) |
| notificationsTriggered | string[] | Which notification types were triggered |

#### Response — Idempotent Re-Sync

**Status**: `200 OK`

```json
{
  "success": true,
  "result": {
    "runStatus": "already_exists",
    "projectStatus": "existing",
    "casesStored": 0,
    "patternsStored": 0,
    "patternsDeduped": 0,
    "notificationsTriggered": []
  }
}
```

#### Error Responses

**Status**: `400 Bad Request` — Validation error
```json
{
  "success": false,
  "error": "Validation failed: run.id is required",
  "code": "VALIDATION_ERROR"
}
```

**Status**: `401 Unauthorized` — Invalid API key
```json
{
  "success": false,
  "error": "Invalid or missing API key",
  "code": "AUTH_INVALID_KEY"
}
```

**Status**: `403 Forbidden` — Team mismatch
```json
{
  "success": false,
  "error": "Team name 'wrong-team' does not match API key team 'payment-team'",
  "code": "AUTH_TEAM_MISMATCH"
}
```

**Status**: `413 Payload Too Large`
```json
{
  "success": false,
  "error": "Sync payload exceeds 10MB limit",
  "code": "PAYLOAD_TOO_LARGE"
}
```

**Status**: `503 Service Unavailable` — Database error
```json
{
  "success": false,
  "error": "Database temporarily unavailable",
  "code": "SERVICE_UNAVAILABLE"
}
```

---

### POST /api/sync/patterns

**Auth**: Required  
**Description**: Sync diagnostic patterns and fix records separately (for bulk sync of knowledge base).  
**Content-Type**: `application/json`

#### Request Payload

```typescript
interface SyncPatternsPayload {
  project: string;
  team: string;
  patterns: Array<{
    category: string;
    signature: string;
    signaturePattern: string;
    description: string;
    suggestedFix: string;
    confidence: number;
    occurrences: number;
    resolutions: number;
    source: 'built-in' | 'learned';
    firstSeenAt: string;       // ISO datetime
    lastSeenAt: string;        // ISO datetime
  }>;
  fixes?: Array<{
    patternSignature: string;  // Links to pattern by signature
    runId: string;
    caseName: string;
    fixDescription: string;
    success: boolean;
    createdAt: string;         // ISO datetime
  }>;
}
```

#### Response — Success

**Status**: `200 OK`

```json
{
  "success": true,
  "result": {
    "patternsCreated": 2,
    "patternsUpdated": 3,
    "fixesStored": 5
  }
}
```

---

## Sync Queue (Local Side)

### Queue Entry Structure

```typescript
interface SyncQueueEntry {
  id: string;           // UUID
  payload: string;      // JSON-serialized SyncRunsPayload or SyncPatternsPayload
  type: 'run' | 'patterns';
  status: 'pending' | 'sending' | 'completed' | 'failed';
  attempts: number;
  maxRetries: number;   // Default: 10
  createdAt: string;    // ISO datetime
  nextRetryAt: string;  // ISO datetime
  lastError: string | null;
}
```

### Retry Strategy

| Attempt | Delay | Cumulative Wait |
|---------|-------|-----------------|
| 1 | 5s | 5s |
| 2 | 10s | 15s |
| 3 | 20s | 35s |
| 4 | 40s | 1m 15s |
| 5 | 80s | 2m 35s |
| 6 | 160s | 5m 15s |
| 7 | 300s (capped) | 10m 15s |
| 8 | 300s | 15m 15s |
| 9 | 300s | 20m 15s |
| 10 | 300s | 25m 15s |

After 10 failed attempts, the entry is marked `failed` and a warning is logged.

### Background Timer

- **Check interval**: 30 seconds
- **Batch size**: 5 entries per cycle (prevents flooding after long outage)
- **Ordering**: Chronological (oldest first — `ORDER BY created_at ASC`)
- **Concurrency**: Single-threaded (one sync at a time to preserve ordering)

### Queue Operations

```typescript
interface SyncQueue {
  /** Enqueue a sync payload. Returns the queue entry ID. */
  enqueue(type: 'run' | 'patterns', payload: object): string;
  
  /** Get pending entries ready for retry (status=pending, nextRetryAt <= now). */
  getPending(limit?: number): SyncQueueEntry[];
  
  /** Mark entry as currently being sent. */
  markSending(id: string): void;
  
  /** Mark entry as successfully synced. Optionally delete it. */
  markCompleted(id: string): void;
  
  /** Mark entry as failed, increment attempts, calculate next retry. */
  markFailed(id: string, error: string): void;
  
  /** Get queue statistics. */
  getStats(): { pending: number; sending: number; failed: number; total: number };
  
  /** Remove all completed entries. */
  cleanup(): number;
}
```

---

## Sync Flow Diagrams

### Auto Sync (Happy Path)

```
Developer Machine                              ArgusAI Server
────────────────                              ──────────────
     │                                              │
     │  argusai-mcp: run tests                      │
     │──────────────────────▶                       │
     │  ... Docker execution ...                    │
     │                                              │
     │  HistoryRecorder.recordRun()                 │
     │────▶ RemoteHistoryStore.saveRun()            │
     │      ├── local.saveRun()  ✅                  │
     │      └── syncQueue.enqueue('run', payload)   │
     │                                              │
     │  [Background timer — 0-30s later]            │
     │                                              │
     │  SyncManager picks up pending entry          │
     │────────────────────────────────────────────▶ │
     │  POST /api/sync/runs                         │
     │  X-API-Key: <key>                            │
     │  Body: { project, team, run, cases }         │
     │                                              │
     │  ◀──────────────────────────────────────────│
     │  200 OK { runStatus: "created" }             │
     │                                              │
     │  syncQueue.markCompleted(id)                 │
     │                                              │
```

### Sync with Server Outage

```
Developer Machine                              ArgusAI Server
────────────────                              ──────────────
     │                                              │
     │  saveRun() → local ✅ + enqueue ✅             │  ❌ DOWN
     │                                              │
     │  [Timer: attempt 1]                          │
     │──────── POST /api/sync/runs ────────────────▶│  ❌ TIMEOUT
     │  markFailed("Connection timeout")            │
     │  nextRetryAt = now + 5s                      │
     │                                              │
     │  [Timer: attempt 2]                          │
     │──────── POST /api/sync/runs ────────────────▶│  ❌ TIMEOUT
     │  markFailed("Connection timeout")            │
     │  nextRetryAt = now + 10s                     │
     │                                              │
     │  ... more test runs happen locally ...        │
     │  (each enqueued, local store unaffected)     │
     │                                              │
     │                                              │  ✅ UP
     │  [Timer: attempt 3]                          │
     │──────── POST /api/sync/runs (run 1) ────────▶│
     │  ◀──── 200 OK ──────────────────────────────│
     │  markCompleted(run 1)                        │
     │                                              │
     │  [Timer: next cycle]                         │
     │──────── POST /api/sync/runs (run 2) ────────▶│
     │  ◀──── 200 OK ──────────────────────────────│
     │  ... continues until queue is empty ...      │
```

### Manual Sync

```bash
# CLI command triggers immediate sync of all pending entries
argusai sync

# Or sync a specific project
argusai sync --project payment-service
```

```
Developer Machine                              ArgusAI Server
────────────────                              ──────────────
     │                                              │
     │  argusai sync                                │
     │────▶ SyncManager.syncNow()                   │
     │      Get all pending entries                  │
     │      For each entry (chronological):          │
     │────────── POST /api/sync/runs ──────────────▶│
     │  ◀──── 200 OK ─────────────────────────────│
     │      markCompleted()                         │
     │                                              │
     │  Report: "3 runs synced, 0 failed"           │
```

---

## Server-Side Processing

### Sync Receive Flow

```
POST /api/sync/runs arrives
       │
       ▼
  Validate API Key
  → Extract teamId
       │
       ▼
  Validate team name matches API key
       │
       ▼
  Find or create project (auto-registration)
  → INSERT ON CONFLICT DO NOTHING for project
       │
       ▼
  Store run (idempotent)
  → INSERT ON CONFLICT (id) DO NOTHING for test_run
  → INSERT ON CONFLICT (id) DO NOTHING for each test_case_run
       │
       ▼
  Process patterns (if included)
  → Find by (team_id, signature)
  → New: INSERT | Existing: INCREMENT occurrences
       │
       ▼
  Trigger notifications (async, non-blocking)
  → Check team notification config
  → If run has failures AND onFailure enabled → queue 企微 notification
  → If new flaky detected AND onNewFlaky enabled → queue flaky alert
       │
       ▼
  Return response
  → { runStatus, projectStatus, casesStored, notificationsTriggered }
```

---

## Payload Size Estimation

For a typical test run with 50 test cases:

| Component | Approximate Size |
|-----------|-----------------|
| Run metadata | ~500 bytes |
| 50 cases (no errors) | ~15 KB |
| 50 cases (with errors + snapshots) | ~100 KB |
| 5 diagnostic patterns | ~3 KB |
| **Typical total** | **~20-120 KB** |

For a large suite with 500 cases: ~200 KB - 1 MB.

The 10 MB limit comfortably handles suites with up to 5000+ test cases.

---

## Security Considerations

1. **API key transmission**: HTTPS required in production (enforced at deployment, not in code)
2. **Payload validation**: Server validates all fields with Zod before processing
3. **SQL injection**: Drizzle ORM parameterizes all queries
4. **Snapshot data**: `snapshot` field may contain container logs — sensitive data should be stripped locally before sync
5. **Rate limiting**: 100 sync requests/minute per team prevents abuse
