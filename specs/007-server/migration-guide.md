# Migration Guide: ArgusAI Local → Server Mode

**Feature**: 007-server  
**Last Updated**: 2026-03-09

---

## Overview

This guide covers upgrading from a local-only ArgusAI installation to one that syncs results to a central ArgusAI Server. The upgrade is **fully backward-compatible** — your local workflow continues to work unchanged.

---

## What Changes

### 1. Drizzle ORM Migration (Automatic)

ArgusAI now uses Drizzle ORM internally instead of direct `better-sqlite3` calls. This migration is transparent:

- **Automatic**: The first time you run ArgusAI after upgrading, migration v3 runs automatically
- **Additive**: New columns are added to existing tables (all nullable)
- **Non-destructive**: All existing data is preserved
- **Backward-compatible**: The `HistoryStore` interface is unchanged

New columns added to `test_runs`:
- `team_id` (TEXT, nullable) — populated when syncing to server
- `project_id` (TEXT, nullable) — populated when syncing to server
- `source_developer` (TEXT, nullable) — hostname of the machine that ran the test
- `synced_at` (TEXT, nullable) — timestamp when run was synced

New columns added to `failure_patterns`:
- `team_id` (TEXT, nullable)
- `project_id` (TEXT, nullable)

New table created:
- `sync_queue` — local queue for pending sync operations

### 2. Server Configuration (Optional)

A new optional `server` section in `e2e.yaml`:

```yaml
server:
  url: "https://argusai.your-server.com"
  apiKey: "${ARGUSAI_API_KEY}"
  team: "my-team"
  sync: auto    # auto | manual | disabled
```

If you don't add this section, nothing changes. ArgusAI continues to work in local-only mode.

### 3. History Store Wrapping (Automatic)

When `server` config is present:
- `DrizzleHistoryStore` is wrapped with `RemoteHistoryStore`
- `saveRun()` writes locally AND enqueues for server sync
- All read operations continue to use local data
- Sync failures never affect local operations

---

## Upgrade Steps

### Step 1: Update ArgusAI

```bash
npm update argusai-core argusai-cli argusai-mcp argusai-dashboard
```

### Step 2: Verify Local Data (Recommended)

```bash
# Run your tests once to trigger the migration
argusai run

# Check that history data is intact
argusai history list
```

The migration runs automatically on first access. You should see:
```
[migration] Applying v3 migration (Drizzle bridge)...
[migration] v3 migration complete
```

### Step 3: Add Server Config (Optional)

If you want to sync to a server, add the `server` section to your `e2e.yaml` (see [Quick Start Guide](./quickstart.md#scenario-a-local-development-with-server-sync)).

### Step 4: Verify Sync (If Server Configured)

```bash
argusai sync --status
argusai sync --ping
```

---

## Troubleshooting

### Migration Fails

If the automatic migration fails:

1. **Check the error message**: It usually indicates a file permission issue or corrupted database
2. **Backup your database**: The SQLite file is in your project's `.argusai/` directory
3. **Manual migration**: Delete `.argusai/history.db` to start fresh (you'll lose local history)
4. **Report the issue**: File a bug with the error message

### Sync Doesn't Work

1. **Check connectivity**: `argusai sync --ping`
2. **Check API key**: Ensure `ARGUSAI_API_KEY` environment variable is set
3. **Check queue**: `argusai sync --status` shows pending/failed items
4. **Force sync**: `argusai sync` processes all pending items immediately
5. **Check logs**: Look for `[sync]` prefixed messages in console output

### Performance Degradation

The sync overhead should be < 5% of test execution time:

- Sync is fully asynchronous — it never blocks test execution
- `saveRun()` writes locally first, then enqueues (non-blocking)
- Network calls happen in background on a 30-second timer
- If you notice significant overhead, check with `sync: disabled` to confirm

### Rollback

To completely revert to local-only mode:

1. Remove the `server` section from `e2e.yaml`
2. (Optional) Unset `ARGUSAI_API_KEY` environment variable
3. The Drizzle ORM migration cannot be rolled back, but it doesn't affect local behavior

---

## Data Preservation Guarantees

| Scenario | Your Data |
|----------|-----------|
| Upgrade without server config | All local data preserved, no behavior change |
| Add server config | Local data preserved + future runs sync to server |
| Remove server config | Local data preserved, sync stops, queued items remain |
| Server goes down | Local data preserved, sync pauses, auto-resumes when server recovers |
| Downgrade ArgusAI version | v3 migration columns are ignored by older versions |

---

## FAQ

**Q: Will my existing local test history be uploaded to the server?**

No. Only new test runs (after configuring the server) will sync. Historical data stays in your local SQLite database.

**Q: Can I use different API keys for different projects?**

Not currently. The API key is per-team, and all projects within a team share the same key. Multiple teams are supported for organization-level separation.

**Q: What happens if two developers sync the same run ID?**

The server handles this via idempotent inserts. The second sync of the same run ID is a no-op.

**Q: Is there a size limit on synced data?**

The server accepts payloads up to 10MB per sync request. This easily covers thousands of test cases per run.
