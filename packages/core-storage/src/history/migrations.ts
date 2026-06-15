/**
 * @module history/migrations
 * SQLite schema migrations using user_version pragma for version tracking.
 */

import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  description: string;
  up: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Create test_runs and test_case_runs tables with indexes',
    up: [
      `CREATE TABLE IF NOT EXISTS test_runs (
        id          TEXT PRIMARY KEY,
        project     TEXT NOT NULL,
        timestamp   INTEGER NOT NULL,
        git_commit  TEXT,
        git_branch  TEXT,
        config_hash TEXT NOT NULL,
        trigger     TEXT NOT NULL CHECK (trigger IN ('cli', 'mcp', 'dashboard', 'ci')),
        duration    INTEGER NOT NULL DEFAULT 0,
        passed      INTEGER NOT NULL DEFAULT 0,
        failed      INTEGER NOT NULL DEFAULT 0,
        skipped     INTEGER NOT NULL DEFAULT 0,
        flaky       INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS test_case_runs (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
        suite_id    TEXT NOT NULL,
        case_name   TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
        duration    INTEGER NOT NULL DEFAULT 0,
        attempts    INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
        response_ms INTEGER,
        assertions  INTEGER,
        error       TEXT,
        snapshot    TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_runs_project_ts ON test_runs(project, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_runs_project_status ON test_runs(project, status)',
      'CREATE INDEX IF NOT EXISTS idx_cases_run_id ON test_case_runs(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_cases_suite_case ON test_case_runs(suite_id, case_name)',
      'CREATE INDEX IF NOT EXISTS idx_cases_name_ts ON test_case_runs(case_name, created_at DESC)',
    ],
  },
  {
    version: 2,
    description: 'Create failure_patterns and fix_history tables for diagnostics knowledge base',
    up: [
      `CREATE TABLE IF NOT EXISTS failure_patterns (
        id                TEXT PRIMARY KEY,
        category          TEXT NOT NULL CHECK (category IN (
          'ASSERTION_MISMATCH', 'HTTP_ERROR', 'TIMEOUT', 'CONNECTION_REFUSED',
          'CONTAINER_OOM', 'CONTAINER_CRASH', 'MOCK_MISMATCH', 'CONFIG_ERROR',
          'NETWORK_ERROR', 'UNKNOWN'
        )),
        signature         TEXT NOT NULL UNIQUE,
        signature_pattern TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        suggested_fix     TEXT NOT NULL DEFAULT '',
        confidence        REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
        occurrences       INTEGER NOT NULL DEFAULT 0 CHECK (occurrences >= 0),
        resolutions       INTEGER NOT NULL DEFAULT 0 CHECK (resolutions >= 0),
        source            TEXT NOT NULL DEFAULT 'learned' CHECK (source IN ('built-in', 'learned')),
        first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_patterns_signature ON failure_patterns(signature)',
      'CREATE INDEX IF NOT EXISTS idx_patterns_category ON failure_patterns(category)',
      'CREATE INDEX IF NOT EXISTS idx_patterns_source ON failure_patterns(source)',
      `CREATE TABLE IF NOT EXISTS fix_history (
        id              TEXT PRIMARY KEY,
        pattern_id      TEXT NOT NULL REFERENCES failure_patterns(id) ON DELETE CASCADE,
        run_id          TEXT NOT NULL,
        case_name       TEXT NOT NULL,
        fix_description TEXT NOT NULL,
        success         INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0, 1)),
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_fix_history_pattern ON fix_history(pattern_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_fix_history_run ON fix_history(run_id)',
      `INSERT OR IGNORE INTO failure_patterns (id, category, signature, signature_pattern, description, suggested_fix, confidence, occurrences, resolutions, source)
      VALUES
        ('builtin-conn-refused',  'CONNECTION_REFUSED', 'builtin::CONNECTION_REFUSED',  'ECONNREFUSED *:*',                      'Service connection refused',                '服务可能未完全启动，尝试增加 healthcheck.startPeriod',                    0.5, 0, 0, 'built-in'),
        ('builtin-timeout',       'TIMEOUT',            'builtin::TIMEOUT',             'ETIMEDOUT / timeout exceeded',           'Request or operation timed out',            '请求超时，检查服务响应时间或增加 timeout 配置',                           0.5, 0, 0, 'built-in'),
        ('builtin-container-oom', 'CONTAINER_OOM',      'builtin::CONTAINER_OOM',       'OOMKilled = true',                       'Container killed due to out of memory',     '容器内存不足，增加 container memory limit 或优化内存使用',                 0.5, 0, 0, 'built-in'),
        ('builtin-http-error',    'HTTP_ERROR',          'builtin::HTTP_ERROR',          'returned 5xx',                           'HTTP server error response',                '服务端错误，检查容器日志定位 root cause',                                  0.5, 0, 0, 'built-in'),
        ('builtin-mock-mismatch', 'MOCK_MISMATCH',       'builtin::MOCK_MISMATCH',      'mock unexpected request',                'Mock service received unexpected request',  'Mock 服务收到未预期请求，检查 mock routes 配置是否完整',                    0.5, 0, 0, 'built-in'),
        ('builtin-assertion',     'ASSERTION_MISMATCH',  'builtin::ASSERTION_MISMATCH',  'expected .* to (equal|match|be)',        'Test assertion failed',                     '断言失败，检查测试期望值或服务返回值是否正确',                              0.5, 0, 0, 'built-in')`,
    ],
  },
  {
    version: 3,
    description: 'Add server columns to test_runs and failure_patterns, create sync_queue table',
    up: [
      'ALTER TABLE test_runs ADD COLUMN team_id TEXT',
      'ALTER TABLE test_runs ADD COLUMN project_id TEXT',
      'ALTER TABLE test_runs ADD COLUMN source_developer TEXT',
      'ALTER TABLE test_runs ADD COLUMN synced_at TEXT',
      'ALTER TABLE failure_patterns ADD COLUMN team_id TEXT',
      'ALTER TABLE failure_patterns ADD COLUMN project_id TEXT',
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id            TEXT PRIMARY KEY,
        payload       TEXT NOT NULL,
        type          TEXT NOT NULL CHECK (type IN ('run', 'patterns')),
        status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'completed', 'failed')),
        attempts      INTEGER NOT NULL DEFAULT 0,
        max_retries   INTEGER NOT NULL DEFAULT 10,
        created_at    TEXT NOT NULL,
        next_retry_at TEXT NOT NULL,
        last_error    TEXT
      )`,
      'CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, next_retry_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_team_project ON test_runs(team_id, project_id, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_patterns_team_sig ON failure_patterns(team_id, signature)',
    ],
  },
];

/**
 * Apply pending migrations to the database.
 * Uses the SQLite `user_version` pragma to track the current schema version.
 */
export function applyMigrations(db: Database.Database): void {
  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      const migrate = db.transaction(() => {
        for (const sql of migration.up) {
          db.exec(sql);
        }
        db.pragma(`user_version = ${migration.version}`);
      });
      migrate();
    }
  }
}
