# Quick Start Guide: ArgusAI Server

**Feature**: 007-server  
**Last Updated**: 2026-03-09

---

## Table of Contents

1. [Scenario A: Local Development with Server Sync](#scenario-a-local-development-with-server-sync)
2. [Scenario B: Self-Hosted Server Deployment](#scenario-b-self-hosted-server-deployment)
3. [Scenario C: Team Onboarding](#scenario-c-team-onboarding)
4. [Scenario D: 企微 Notification Setup](#scenario-d-企微-notification-setup)

---

## Scenario A: Local Development with Server Sync

**Goal**: Configure an existing local ArgusAI setup to sync results to a team server.

### Prerequisites

- ArgusAI CLI/MCP already working locally (tests pass without server)
- ArgusAI Server running and accessible (see Scenario B for setup)
- A team API key (see Scenario C for team creation)

### Step 1: Add Server Configuration to `e2e.yaml`

```yaml
# e2e.yaml — add the server section
project:
  name: payment-service

server:
  url: "https://argusai.your-company.com"
  apiKey: "${ARGUSAI_API_KEY}"
  team: "payment-team"
  sync: auto
```

### Step 2: Set the API Key

```bash
# Option 1: Environment variable (recommended)
export ARGUSAI_API_KEY="your-64-char-hex-key-here"

# Option 2: .env file in project directory
echo 'ARGUSAI_API_KEY=your-64-char-hex-key-here' >> .env
```

### Step 3: Run Tests Normally

```bash
# Tests run exactly as before — local Docker execution
argusai run

# Or via MCP tools (for AI agents)
# The mcp server handles sync transparently
```

After the test completes, results are automatically synced to the server. You'll see a log line:

```
[sync] Results synced to server (run: abc123, 20 cases)
```

### Step 4: Verify on Dashboard

Open the team Dashboard and navigate to `payment-service` — you should see the run appear within 30 seconds.

### Troubleshooting

```bash
# Check sync queue status
argusai sync --status

# Output:
# Sync queue: 0 pending, 0 failed
# Last sync: 2026-03-09 14:30:25 (success)
# Server: https://argusai.your-company.com (reachable)

# Force sync all pending
argusai sync

# Test server connectivity
argusai sync --ping
```

---

## Scenario B: Self-Hosted Server Deployment

**Goal**: Deploy the ArgusAI Server using Docker Compose.

### Prerequisites

- Docker 24+ and Docker Compose v2 installed
- PostgreSQL is recommended; SQLite is supported for evaluation

### Step 1: Clone the Repository

```bash
git clone https://github.com/jeffkit/argusai.git
cd argusai/packages/server
```

### Step 2: Create `.env` File

```bash
cat > .env << 'EOF'
DB_PASSWORD=your-secure-password
SERVER_PORT=3000
DASHBOARD_PORT=5173
EOF
```

### Step 3: Start the Server

```bash
# Server + PostgreSQL only
docker compose up -d

# Full stack including Dashboard
docker compose --profile full up -d

# Verify all services are running
docker compose ps

# Check server logs
docker compose logs argusai-server
```

Expected output:
```
ArgusAI Server listening on 0.0.0.0:3000
```

### Step 4: Verify Health

```bash
curl http://localhost:3000/api/health

# Response:
# { "status": "ok", "service": "argusai-server", "database": "connected" }
```

### Step 5: View API Documentation

Open `http://localhost:3000/api/docs` in your browser for the Swagger UI with all API endpoints.

### Lightweight Deployment (SQLite)

For evaluation or small teams (< 5 developers), you can skip PostgreSQL:

```bash
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="file:/data/argusai.db" \
  -e DATABASE_DIALECT=sqlite \
  -v argusai-data:/data \
  argusai/server:latest
```

---

## Scenario C: Team Onboarding

**Goal**: Create a team, get an API key, and distribute it to team members.

### Step 1: Create a Team

```bash
curl -X POST http://localhost:3000/api/teams \
  -H "Content-Type: application/json" \
  -d '{ "name": "payment-team" }'
```

Response:
```json
{
  "success": true,
  "team": {
    "id": "550e8400-...",
    "name": "payment-team",
    "createdAt": "2026-03-09T14:30:00.000Z"
  },
  "apiKey": "a1b2c3d4e5f6...64chars",
  "warning": "Save this API key now — it will not be shown again."
}
```

**Save the `apiKey` value** — it is only shown once.

### Step 2: Distribute the API Key

Share the API key with team members through a secure channel (password manager, encrypted chat, etc.).

Each team member adds to their environment:

```bash
export ARGUSAI_API_KEY="a1b2c3d4e5f6...64chars"
```

### Step 3: Each Member Configures Their `e2e.yaml`

```yaml
server:
  url: "https://argusai.your-company.com"
  apiKey: "${ARGUSAI_API_KEY}"
  team: "payment-team"
  sync: auto
```

### Step 4: Verify Team Setup

```bash
# Check team info
curl -H "X-API-Key: $ARGUSAI_API_KEY" http://localhost:3000/api/teams

# List projects (initially empty)
curl -H "X-API-Key: $ARGUSAI_API_KEY" http://localhost:3000/api/projects

# After first test run, project appears automatically
```

### Key Rotation

If the API key is compromised:

```bash
TEAM_ID="550e8400-..."
curl -X POST -H "X-API-Key: $ARGUSAI_API_KEY" \
  "http://localhost:3000/api/teams/$TEAM_ID/reset-key"

# Response includes new key — old key is immediately invalidated
# Distribute new key to all team members
```

---

## Scenario D: 企微 Notification Setup

**Goal**: Configure Enterprise WeChat (企微) group bot notifications for test failures.

### Step 1: Create a 企微 Group Bot

1. Open the 企微 group chat
2. Click group settings → Group Bots → Add Bot
3. Copy the Webhook URL: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx`

### Step 2: Configure Notifications on the Server

```bash
TEAM_ID="550e8400-..."

curl -X PUT -H "X-API-Key: $ARGUSAI_API_KEY" \
  -H "Content-Type: application/json" \
  "http://localhost:3000/api/teams/$TEAM_ID/notifications" \
  -d '{
    "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY",
    "onFailure": true,
    "onSuccess": false,
    "onNewFlaky": true,
    "dailyDigest": true,
    "digestTime": "09:00",
    "digestTimezone": "Asia/Shanghai"
  }'
```

### Step 3: Test the Notification

Run a test that you know will fail, then check the 企微 group. Within 60 seconds, a notification like this should appear:

```
**ArgusAI 测试失败通知**

> 项目: **payment-service**
> 团队: payment-team
> 运行时间: 2026/3/9 22:30:00

**结果摘要**
通过: 18 | 失败: 2 | 跳过: 1 | Flaky: 1

**失败用例**
1. health-check — Connection refused
2. payment-flow — Expected 200, got 500
```

### Notification Triggers

| Trigger | Default | Description |
|---------|---------|-------------|
| `onFailure` | ON | Notify when any test case fails |
| `onSuccess` | OFF | Notify when all tests pass |
| `onNewFlaky` | OFF | Notify when a new flaky test is detected |
| `dailyDigest` | OFF | Daily summary at configured time |

---

## Frequently Asked Questions

### What happens if I remove the `server` section from `e2e.yaml`?

Everything works exactly as before — fully local, no sync, no server dependency. Your existing local data is unaffected.

### Can I use ArgusAI locally without any server?

Yes. ArgusAI is local-first. The server is entirely optional and additive. All features (test execution, flaky detection, history, diagnostics) work locally.

### What happens during a server outage?

- Local test execution is completely unaffected
- Results are saved locally as normal
- Sync attempts fail silently (warning in logs)
- Results are queued and automatically synced when the server recovers
- Queue supports up to 24 hours of results without data loss

### How do I migrate from pure local to server mode?

1. Deploy the server (Scenario B)
2. Create a team (Scenario C)
3. Add `server` section to `e2e.yaml` (Scenario A)
4. Historical local data stays in local SQLite — it is NOT automatically uploaded
5. All future runs will sync automatically

### Can multiple developers sync to the same project?

Yes. That's the intended usage. Each developer has the same API key and team name. All their results are aggregated under the same project on the server. The Dashboard shows a unified view of all team members' runs.

### What's the difference between SQLite and PostgreSQL for the server?

| Feature | SQLite (server) | PostgreSQL |
|---------|----------------|------------|
| Concurrent writes | Limited (WAL mode helps) | Excellent |
| Scale | < 5 developers | Unlimited |
| Setup | Zero (file-based) | Requires container |
| Backup | Copy file | pg_dump |
| Recommended for | Evaluation, small teams | Production |
