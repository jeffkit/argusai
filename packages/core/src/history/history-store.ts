/**
 * @module history/history-store
 * HistoryStore interface and SQLiteHistoryStore implementation.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { TestRunRecord, TestCaseRunRecord, HistoryConfig } from './types.js';
import type { ServerConfig } from '../types.js';
import { applyMigrations } from './migrations.js';
import { MemoryHistoryStore } from './memory-history-store.js';
import { createSqliteDbFromDatabase } from '../db/create-db.js';
import { DrizzleHistoryStore } from '../db/drizzle-history-store.js';
import { SyncQueue } from '../sync/sync-queue.js';
import { SyncClient } from '../sync/sync-client.js';
import { SyncManager } from '../sync/sync-manager.js';
import { RemoteHistoryStore } from '../sync/remote-history-store.js';

/** Options for querying runs. */
export interface GetRunsOptions {
  limit?: number;
  offset?: number;
  status?: 'passed' | 'failed';
  days?: number;
}

/** Paginated result of run queries. */
export interface GetRunsResult {
  runs: TestRunRecord[];
  total: number;
}

/** Interface for persisting and querying test history data. */
export interface HistoryStore {
  saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void;
  getRuns(project: string, options: GetRunsOptions): GetRunsResult;
  getRunById(id: string): { run: TestRunRecord; cases: TestCaseRunRecord[] } | null;
  getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[];
  getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[];
  getCasesForRun(runId: string): TestCaseRunRecord[];
  getDistinctCaseNames(project: string, options?: { suiteId?: string; limit?: number }): string[];
  cleanup(project: string, maxAge: string, maxRuns: number): number;
  close(): void;
}

// =====================================================================
// SQLiteHistoryStore
// =====================================================================

export class SQLiteHistoryStore implements HistoryStore {
  private db: Database.Database;

  /** Expose underlying database for shared subsystems (e.g. knowledge store). */
  getDatabase(): Database.Database {
    return this.db;
  }

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('cache_size = -8000');
    this.db.pragma('foreign_keys = ON');

    applyMigrations(this.db);
  }

  saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void {
    const insertRun = this.db.prepare(`
      INSERT INTO test_runs (id, project, timestamp, git_commit, git_branch, config_hash, trigger, duration, passed, failed, skipped, flaky, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCase = this.db.prepare(`
      INSERT INTO test_case_runs (id, run_id, suite_id, case_name, status, duration, attempts, response_ms, assertions, error, snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      const createdAt = new Date(run.timestamp).toISOString();
      insertRun.run(
        run.id, run.project, run.timestamp, run.gitCommit, run.gitBranch,
        run.configHash, run.trigger, run.duration, run.passed, run.failed,
        run.skipped, run.flaky, run.status, createdAt,
      );
      for (const c of cases) {
        insertCase.run(
          c.id, c.runId, c.suiteId, c.caseName, c.status, c.duration,
          c.attempts, c.responseMs, c.assertions,
          c.error ? c.error.slice(0, 2000) : null,
          c.snapshot, createdAt,
        );
      }
    });

    transaction();
  }

  getRuns(project: string, options: GetRunsOptions): GetRunsResult {
    const conditions: string[] = ['project = ?'];
    const params: unknown[] = [project];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.days) {
      const cutoffMs = Date.now() - options.days * 24 * 60 * 60 * 1000;
      conditions.push('timestamp >= ?');
      params.push(cutoffMs);
    }

    const where = conditions.join(' AND ');

    const countStmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM test_runs WHERE ${where}`);
    const countRow = countStmt.get(...params) as { cnt: number };
    const total = countRow.cnt;

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = options.offset ?? 0;

    const selectStmt = this.db.prepare(
      `SELECT * FROM test_runs WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    );
    const rows = selectStmt.all(...params, limit, offset) as RunRow[];

    return { runs: rows.map(mapRunRow), total };
  }

  getRunById(id: string): { run: TestRunRecord; cases: TestCaseRunRecord[] } | null {
    const runRow = this.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as RunRow | undefined;
    if (!runRow) return null;

    const caseRows = this.db.prepare(
      'SELECT * FROM test_case_runs WHERE run_id = ? ORDER BY created_at ASC',
    ).all(id) as CaseRow[];

    return { run: mapRunRow(runRow), cases: caseRows.map(mapCaseRow) };
  }

  getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[] {
    let query = `
      SELECT tcr.* FROM test_case_runs tcr
      INNER JOIN test_runs tr ON tcr.run_id = tr.id
      WHERE tcr.case_name = ? AND tr.project = ?
    `;
    const params: unknown[] = [caseName, project];

    if (suiteId) {
      query += ' AND tcr.suite_id = ?';
      params.push(suiteId);
    }

    query += ' ORDER BY tr.timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as CaseRow[];
    return rows.map(mapCaseRow);
  }

  getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM test_runs WHERE project = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
    ).all(project, fromMs, toMs) as RunRow[];
    return rows.map(mapRunRow);
  }

  getCasesForRun(runId: string): TestCaseRunRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM test_case_runs WHERE run_id = ? ORDER BY created_at ASC',
    ).all(runId) as CaseRow[];
    return rows.map(mapCaseRow);
  }

  getDistinctCaseNames(project: string, options?: { suiteId?: string; limit?: number }): string[] {
    let query = `
      SELECT DISTINCT tcr.case_name FROM test_case_runs tcr
      INNER JOIN test_runs tr ON tcr.run_id = tr.id
      WHERE tr.project = ?
    `;
    const params: unknown[] = [project];

    if (options?.suiteId) {
      query += ' AND tcr.suite_id = ?';
      params.push(options.suiteId);
    }

    query += ' ORDER BY tcr.case_name ASC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{ case_name: string }>;
    return rows.map(r => r.case_name);
  }

  cleanup(project: string, maxAge: string, maxRuns: number): number {
    let totalDeleted = 0;

    // Time-based cleanup
    const daysMatch = maxAge.match(/^(\d+)d$/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]!, 10);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(
        'DELETE FROM test_runs WHERE project = ? AND timestamp < ?',
      ).run(project, cutoffMs);
      totalDeleted += result.changes;
    }

    // Count-based cleanup
    const countResult = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM test_runs WHERE project = ?',
    ).get(project) as { cnt: number };

    if (countResult.cnt > maxRuns) {
      const excess = countResult.cnt - maxRuns;
      const result = this.db.prepare(`
        DELETE FROM test_runs WHERE id IN (
          SELECT id FROM test_runs WHERE project = ? ORDER BY timestamp ASC LIMIT ?
        )
      `).run(project, excess);
      totalDeleted += result.changes;
    }

    return totalDeleted;
  }

  close(): void {
    this.db.close();
  }
}

// =====================================================================
// Factory
// =====================================================================

// =====================================================================
// NoopHistoryStore — returned when history is disabled
// =====================================================================

export class NoopHistoryStore implements HistoryStore {
  saveRun(): void { /* no-op */ }
  getRuns(): GetRunsResult { return { runs: [], total: 0 }; }
  getRunById(): null { return null; }
  getCaseHistory(): TestCaseRunRecord[] { return []; }
  getRunsInDateRange(): TestRunRecord[] { return []; }
  getCasesForRun(): TestCaseRunRecord[] { return []; }
  getDistinctCaseNames(): string[] { return []; }
  cleanup(): number { return 0; }
  close(): void { /* no-op */ }
}

/**
 * Create a HistoryStore based on config.
 * - Returns NoopHistoryStore when `enabled: false`
 * - Returns MemoryHistoryStore for `storage: 'memory'`
 * - Returns DrizzleHistoryStore (backed by SQLite) for `storage: 'local'`, with fallback to MemoryHistoryStore on failure
 * - If `serverConfig` is provided and sync is not disabled, wraps with RemoteHistoryStore
 *
 * The underlying better-sqlite3 Database is exposed via `getSharedDatabase()` for the
 * knowledge store and other subsystems that share the same database file.
 */
export function createHistoryStore(
  config: HistoryConfig,
  projectDir: string,
  serverConfig?: ServerConfig,
): HistoryStore {
  if (!config.enabled) {
    return new NoopHistoryStore();
  }

  if (config.storage === 'memory') {
    return new MemoryHistoryStore();
  }

  const dbPath = config.path
    ? path.resolve(projectDir, config.path)
    : path.resolve(projectDir, '.argusai', 'history.db');

  try {
    const sqliteStore = new SQLiteHistoryStore(dbPath);
    const rawDb = sqliteStore.getDatabase();
    const drizzleDb = createSqliteDbFromDatabase(rawDb);
    const drizzleStore = new DrizzleHistoryStore(drizzleDb);

    // Attach the raw DB so callers (knowledge store) can retrieve it
    (drizzleStore as DrizzleHistoryStoreWithDb).__rawDb = rawDb;
    (drizzleStore as DrizzleHistoryStoreWithDb).__sqliteStore = sqliteStore;

    // Override close() to close the underlying SQLite connection
    const originalClose = drizzleStore.close.bind(drizzleStore);
    drizzleStore.close = () => {
      originalClose();
      sqliteStore.close();
    };

    // Wrap with RemoteHistoryStore if server sync is configured and not disabled
    if (serverConfig && serverConfig.sync !== 'disabled') {
      const syncQueueInstance = new SyncQueue(drizzleDb);
      const syncClientInstance = new SyncClient(serverConfig.url, serverConfig.apiKey);
      const remoteStore = new RemoteHistoryStore(drizzleStore, syncQueueInstance, serverConfig);

      // Start background sync manager for auto mode
      if (serverConfig.sync === 'auto') {
        const syncManager = new SyncManager(syncQueueInstance, syncClientInstance);
        syncManager.start();

        // Attach sync manager for external access and cleanup
        (remoteStore as RemoteHistoryStoreWithManager).__syncManager = syncManager;
        (remoteStore as RemoteHistoryStoreWithManager).__syncQueue = syncQueueInstance;

        const remoteClose = remoteStore.close.bind(remoteStore);
        remoteStore.close = () => {
          syncManager.stop();
          remoteClose();
        };
      }

      // Propagate raw DB references for knowledge store sharing
      (remoteStore as unknown as DrizzleHistoryStoreWithDb).__rawDb = rawDb;
      (remoteStore as unknown as DrizzleHistoryStoreWithDb).__sqliteStore = sqliteStore;

      return remoteStore;
    }

    return drizzleStore;
  } catch (err) {
    console.warn(
      `[history] Failed to open SQLite at ${dbPath}, falling back to memory store: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new MemoryHistoryStore();
  }
}

/** Extended type for accessing SyncManager from RemoteHistoryStore. */
export interface RemoteHistoryStoreWithManager extends RemoteHistoryStore {
  __syncManager: SyncManager;
  __syncQueue: SyncQueue;
}

/** Extended type for accessing the shared raw DB from DrizzleHistoryStore created by the factory. */
export interface DrizzleHistoryStoreWithDb extends DrizzleHistoryStore {
  __rawDb: Database.Database;
  __sqliteStore: SQLiteHistoryStore;
}

// =====================================================================
// Row Mapping Helpers
// =====================================================================

interface RunRow {
  id: string;
  project: string;
  timestamp: number;
  git_commit: string | null;
  git_branch: string | null;
  config_hash: string;
  trigger: string;
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  status: string;
  created_at: string;
}

interface CaseRow {
  id: string;
  run_id: string;
  suite_id: string;
  case_name: string;
  status: string;
  duration: number;
  attempts: number;
  response_ms: number | null;
  assertions: number | null;
  error: string | null;
  snapshot: string | null;
  created_at: string;
}

function mapRunRow(row: RunRow): TestRunRecord {
  return {
    id: row.id,
    project: row.project,
    timestamp: row.timestamp,
    gitCommit: row.git_commit,
    gitBranch: row.git_branch,
    configHash: row.config_hash,
    trigger: row.trigger as TestRunRecord['trigger'],
    duration: row.duration,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    flaky: row.flaky,
    status: row.status as TestRunRecord['status'],
  };
}

function mapCaseRow(row: CaseRow): TestCaseRunRecord {
  return {
    id: row.id,
    runId: row.run_id,
    suiteId: row.suite_id,
    caseName: row.case_name,
    status: row.status as TestCaseRunRecord['status'],
    duration: row.duration,
    attempts: row.attempts,
    responseMs: row.response_ms,
    assertions: row.assertions,
    error: row.error,
    snapshot: row.snapshot,
  };
}
