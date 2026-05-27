# REST API Contract: ArgusAI Server

**Feature**: 007-server  
**Date**: 2026-03-09  
**Base URL**: `https://{server-host}/api`

---

## Authentication

All endpoints (except `/api/health` and `POST /api/teams`) require an API key header:

```
X-API-Key: <team-api-key>
```

The server validates the key, resolves the associated team, and scopes all data access to that team.

### Error Responses (Auth)

```json
// 401 Unauthorized — missing or invalid key
{
  "success": false,
  "error": "Invalid or missing API key",
  "code": "AUTH_INVALID_KEY"
}

// 403 Forbidden — key valid but team mismatch
{
  "success": false,
  "error": "Team name in request does not match API key team",
  "code": "AUTH_TEAM_MISMATCH"
}
```

---

## Common Response Envelope

All responses follow a consistent JSON structure:

```typescript
// Success
{
  "success": true,
  "data": { ... }  // or top-level fields for backward compat
}

// Error
{
  "success": false,
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

---

## 1. Health & Status

### GET /api/health

**Auth**: None required  
**Description**: Server health check.

**Response** `200 OK`:
```json
{
  "status": "ok",
  "service": "argusai-server",
  "version": "0.7.0",
  "uptime": 86400,
  "database": "connected",
  "timestamp": "2026-03-09T14:30:00.000Z"
}
```

---

## 2. Team Management

### POST /api/teams

**Auth**: None (bootstrap endpoint — should be protected by network policy in production)  
**Description**: Create a new team and generate an API key.

**Request Body**:
```json
{
  "name": "payment-team"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| name | string | yes | 1-100 chars, `^[a-zA-Z0-9_-]+$` |

**Response** `201 Created`:
```json
{
  "success": true,
  "team": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "payment-team",
    "createdAt": "2026-03-09T14:30:00.000Z"
  },
  "apiKey": "a1b2c3d4e5f6...64chars...hex",
  "warning": "Save this API key now — it will not be shown again."
}
```

**Error** `409 Conflict`:
```json
{
  "success": false,
  "error": "Team name 'payment-team' already exists",
  "code": "TEAM_EXISTS"
}
```

---

### GET /api/teams

**Auth**: Required (returns only the caller's team info)  
**Description**: Get information about the authenticated team.

**Response** `200 OK`:
```json
{
  "success": true,
  "team": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "payment-team",
    "apiKeyPrefix": "a1b2c3d4",
    "projectCount": 5,
    "totalRuns": 1234,
    "createdAt": "2026-03-09T14:30:00.000Z"
  }
}
```

---

### DELETE /api/teams/:id

**Auth**: Required (can only delete own team)  
**Description**: Delete a team and all associated data (projects, runs, patterns, notifications).

**Response** `200 OK`:
```json
{
  "success": true,
  "message": "Team 'payment-team' and all associated data deleted"
}
```

**Error** `403 Forbidden`:
```json
{
  "success": false,
  "error": "Cannot delete a team other than your own",
  "code": "AUTH_FORBIDDEN"
}
```

---

### POST /api/teams/:id/reset-key

**Auth**: Required (can only reset own team's key)  
**Description**: Reset the API key. The old key is immediately invalidated.

**Response** `200 OK`:
```json
{
  "success": true,
  "apiKey": "new-64-char-hex-key...",
  "warning": "Save this API key now — it will not be shown again. The old key is now invalid."
}
```

---

## 3. Projects

### GET /api/projects

**Auth**: Required  
**Description**: List all projects for the authenticated team with summary statistics.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 50 | Max projects to return (1-200) |
| offset | number | 0 | Pagination offset |

**Response** `200 OK`:
```json
{
  "success": true,
  "projects": [
    {
      "id": "proj-uuid-1",
      "name": "payment-service",
      "description": null,
      "totalRuns": 256,
      "lastSyncAt": "2026-03-09T14:30:00.000Z",
      "lastRunStatus": "failed",
      "lastPassRate": 94.5,
      "createdAt": "2026-02-01T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### GET /api/projects/:name

**Auth**: Required  
**Description**: Get detailed information about a specific project.

**Response** `200 OK`:
```json
{
  "success": true,
  "project": {
    "id": "proj-uuid-1",
    "name": "payment-service",
    "description": null,
    "totalRuns": 256,
    "lastSyncAt": "2026-03-09T14:30:00.000Z",
    "recentPassRate": 94.5,
    "totalFlakyTests": 3,
    "activeDevelopers": 4,
    "createdAt": "2026-02-01T10:00:00.000Z"
  }
}
```

**Error** `404 Not Found`:
```json
{
  "success": false,
  "error": "Project 'payment-service' not found",
  "code": "PROJECT_NOT_FOUND"
}
```

---

## 4. Test Runs

### GET /api/runs

**Auth**: Required  
**Description**: List test runs with filtering and pagination. Team-scoped.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| project | string | (required) | Project name |
| limit | number | 20 | Max runs (1-100) |
| offset | number | 0 | Pagination offset |
| status | string | — | Filter: `passed` or `failed` |
| days | number | — | Filter: runs within last N days |

**Response** `200 OK`:
```json
{
  "success": true,
  "runs": [
    {
      "id": "run-uuid-1",
      "project": "payment-service",
      "timestamp": 1741523400000,
      "gitCommit": "abc123",
      "gitBranch": "main",
      "configHash": "hash...",
      "trigger": "cli",
      "duration": 45000,
      "passed": 18,
      "failed": 2,
      "skipped": 1,
      "flaky": 1,
      "status": "failed",
      "sourceDeveloper": "developer-a",
      "syncedAt": "2026-03-09T14:30:25.000Z"
    }
  ],
  "pagination": {
    "total": 256,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### GET /api/runs/:id

**Auth**: Required  
**Description**: Get detailed run information including all test case results and flaky analysis.

**Response** `200 OK`:
```json
{
  "success": true,
  "run": {
    "id": "run-uuid-1",
    "project": "payment-service",
    "timestamp": 1741523400000,
    "gitCommit": "abc123",
    "gitBranch": "main",
    "duration": 45000,
    "passed": 18,
    "failed": 2,
    "skipped": 1,
    "flaky": 1,
    "status": "failed",
    "sourceDeveloper": "developer-a"
  },
  "cases": [
    {
      "id": "case-uuid-1",
      "runId": "run-uuid-1",
      "suiteId": "api-tests",
      "caseName": "health-check",
      "status": "passed",
      "duration": 1200,
      "attempts": 1,
      "responseMs": 45,
      "assertions": 3,
      "error": null,
      "snapshot": null
    }
  ],
  "flaky": [
    {
      "caseName": "payment-flow",
      "suiteId": "api-tests",
      "score": 0.4,
      "level": "FLAKY",
      "recentResults": ["passed", "failed", "passed", "failed", "passed"],
      "failCount": 4,
      "totalRuns": 10
    }
  ]
}
```

---

### GET /api/runs/compare

**Auth**: Required  
**Description**: Compare two test runs to identify regressions and fixes.

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| run1 | string | yes | Base run ID |
| run2 | string | yes | Compare run ID |

**Response** `200 OK`:
```json
{
  "success": true,
  "baseRun": { "id": "run1", "status": "passed", "..." : "..." },
  "compareRun": { "id": "run2", "status": "failed", "..." : "..." },
  "newFailures": [
    {
      "caseName": "payment-flow",
      "suiteId": "api-tests",
      "error": "Expected status 200, got 500",
      "baseStatus": "passed",
      "compareStatus": "failed"
    }
  ],
  "fixed": [],
  "consistent": { "passed": 17, "failed": 0, "skipped": 1 },
  "newCases": ["new-test-case"],
  "removedCases": []
}
```

---

## 5. Trend Analysis

### GET /api/trends/pass-rate

**Auth**: Required  
**Description**: Daily pass rate trend for a project.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| project | string | (required) | Project name |
| days | number | 30 | Lookback period (1-365) |
| suiteId | string | — | Filter by suite |

**Response** `200 OK`:
```json
{
  "success": true,
  "period": { "from": "2026-02-07", "to": "2026-03-09" },
  "granularity": "daily",
  "dataPoints": [
    {
      "date": "2026-02-07",
      "passRate": 95.0,
      "passed": 19,
      "failed": 1,
      "skipped": 0,
      "runCount": 3
    }
  ]
}
```

---

### GET /api/trends/duration

**Auth**: Required  
**Description**: Daily duration trend for a project.

**Query Parameters**: Same as pass-rate (project, days, suiteId).

**Response** `200 OK`:
```json
{
  "success": true,
  "period": { "from": "2026-02-23", "to": "2026-03-09" },
  "dataPoints": [
    {
      "date": "2026-02-23",
      "avgDuration": 42000,
      "minDuration": 38000,
      "maxDuration": 51000,
      "runCount": 5
    }
  ]
}
```

---

### GET /api/trends/flaky

**Auth**: Required  
**Description**: Flaky test ranking for a project.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| project | string | (required) | Project name |
| topN | number | 10 | Max results (1-50) |
| minScore | number | 0.01 | Minimum flaky score threshold |
| suiteId | string | — | Filter by suite |

**Response** `200 OK`:
```json
{
  "success": true,
  "cases": [
    {
      "caseName": "payment-flow",
      "suiteId": "api-tests",
      "score": 0.4,
      "level": "FLAKY",
      "recentResults": ["passed", "failed", "passed", "failed"],
      "failCount": 4,
      "totalRuns": 10
    }
  ],
  "totalFlaky": 3,
  "analysisWindow": 10
}
```

---

### GET /api/trends/failures

**Auth**: Required  
**Description**: Failure trend for a specific test case.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| project | string | (required) | Project name |
| caseName | string | (required) | Test case name |
| days | number | 7 | Lookback period |
| suiteId | string | — | Filter by suite |

**Response** `200 OK`:
```json
{
  "success": true,
  "caseName": "payment-flow",
  "period": { "from": "2026-03-02", "to": "2026-03-09" },
  "dataPoints": [
    {
      "date": "2026-03-02",
      "status": "passed",
      "duration": 1500,
      "error": null,
      "runId": "run-uuid-1"
    },
    {
      "date": "2026-03-03",
      "status": "no-run",
      "duration": null,
      "error": null,
      "runId": null
    }
  ],
  "summary": {
    "totalRuns": 8,
    "failures": 3,
    "flakyScore": 0.4,
    "level": "FLAKY"
  }
}
```

---

## 6. Diagnostics

### GET /api/patterns

**Auth**: Required  
**Description**: List failure patterns for a project.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| project | string | — | Filter by project (all if omitted) |
| category | string | — | Filter by category |
| source | string | — | Filter: `built-in` or `learned` |
| limit | number | 50 | Max results |

**Response** `200 OK`:
```json
{
  "success": true,
  "patterns": [
    {
      "id": "pattern-uuid-1",
      "category": "CONNECTION_REFUSED",
      "signature": "learned::ECONNREFUSED 127.0.0.1:3000",
      "signaturePattern": "ECONNREFUSED *:3000",
      "description": "Service connection refused on port 3000",
      "suggestedFix": "Container may not be fully started",
      "confidence": 0.85,
      "occurrences": 12,
      "resolutions": 8,
      "source": "learned",
      "firstSeenAt": "2026-02-15T10:00:00.000Z",
      "lastSeenAt": "2026-03-09T14:30:00.000Z"
    }
  ],
  "total": 15
}
```

---

### GET /api/patterns/:id/fixes

**Auth**: Required  
**Description**: Get fix history for a specific pattern.

**Query Parameters**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 10 | Max results |

**Response** `200 OK`:
```json
{
  "success": true,
  "fixes": [
    {
      "id": "fix-uuid-1",
      "patternId": "pattern-uuid-1",
      "runId": "run-uuid-1",
      "caseName": "health-check",
      "fixDescription": "Increased healthcheck startPeriod to 60s",
      "success": true,
      "createdAt": "2026-03-08T16:00:00.000Z"
    }
  ]
}
```

---

## 7. Notifications

### GET /api/teams/:id/notifications

**Auth**: Required  
**Description**: Get notification configuration for the team.

**Response** `200 OK`:
```json
{
  "success": true,
  "config": {
    "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    "onFailure": true,
    "onSuccess": false,
    "onNewFlaky": false,
    "dailyDigest": false,
    "digestTime": "09:00",
    "digestTimezone": "Asia/Shanghai"
  }
}
```

---

### PUT /api/teams/:id/notifications

**Auth**: Required  
**Description**: Update notification configuration.

**Request Body**:
```json
{
  "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
  "onFailure": true,
  "onSuccess": false,
  "onNewFlaky": true,
  "dailyDigest": true,
  "digestTime": "09:00",
  "digestTimezone": "Asia/Shanghai"
}
```

All fields are optional — only provided fields are updated.

**Response** `200 OK`:
```json
{
  "success": true,
  "config": { "..." : "..." }
}
```

---

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| AUTH_INVALID_KEY | 401 | Missing or invalid API key |
| AUTH_TEAM_MISMATCH | 403 | API key doesn't match requested team |
| AUTH_FORBIDDEN | 403 | Operation not permitted |
| TEAM_EXISTS | 409 | Team name already exists |
| TEAM_NOT_FOUND | 404 | Team ID not found |
| PROJECT_NOT_FOUND | 404 | Project not found in team |
| RUN_NOT_FOUND | 404 | Run ID not found |
| VALIDATION_ERROR | 400 | Request body validation failed |
| SYNC_ERROR | 500 | Internal error during sync processing |
| SERVER_ERROR | 500 | Unexpected server error |
| SERVICE_UNAVAILABLE | 503 | Database or dependency unavailable |

---

## Rate Limiting

| Endpoint Group | Limit | Window |
|---------------|-------|--------|
| Sync (POST /api/sync/*) | 100 req/min | Per team |
| Query (GET /api/*) | 300 req/min | Per team |
| Team management | 10 req/min | Per team |

Rate limit headers included in all responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1741523460
```
