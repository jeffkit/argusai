/**
 * @module history/history-store
 * HistoryStore interface, the SQLite bootstrap store, and the store factory.
 *
 * ## Storage layering (read this before touching the two SQLite stores)
 *
 * ArgusAI has two SQLite-backed classes that look redundant but play distinct roles:
 *
 * - {@link DrizzleHistoryStore} (`db/drizzle-history-store.ts`) — the **single
 *   source of truth** for all history query logic.
 * - {@link SQLiteHistoryStore} (this file, `better-sqlite3`) — owns the physical
 *   connection lifecycle only: it creates the DB file, runs {@link applyMigrations},
 *   and exposes the raw handle via `getDatabase()`. Its `HistoryStore` methods
 *   delegate to an internal `DrizzleHistoryStore` over the same connection, so no
 *   SQL is duplicated between the two classes.
 *
 * {@link createHistoryStore} opens a `SQLiteHistoryStore` to bootstrap the
 * connection + migrations, then wraps the same raw handle in a Drizzle instance
 * and returns *that*. The knowledge store shares the same raw handle via the
 * `__rawDb` back-reference attached in the factory below.
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

/**
 * SQLite-backed store that owns the physical DB connection and migrations.
 *
 * This class is responsible for the connection lifecycle only — opening the
 * file, applying {@link applyMigrations}, exposing the raw handle via
 * `getDatabase()`, and closing it. All query methods delegate to an internal
 * {@link DrizzleHistoryStore} over the same connection, so there is a single
 * source of truth for history query logic (no duplicated SQL).
 *
 * In the standard runtime path (see {@link createHistoryStore}) the returned
 * store is a `DrizzleHistoryStore` wrapping `getDatabase()`; this class is used
 * there purely to bootstrap the connection.
 */
export class SQLiteHistoryStore implements HistoryStore {
  private db: Database.Database;
  /** Canonical query layer over the same connection — the single source of SQL truth. */
  private delegate: DrizzleHistoryStore;

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

    this.delegate = new DrizzleHistoryStore(createSqliteDbFromDatabase(this.db));
  }

  saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void {
    this.delegate.saveRun(run, cases);
  }

  getRuns(project: string, options: GetRunsOptions): GetRunsResult {
    return this.delegate.getRuns(project, options);
  }

  getRunById(id: string): { run: TestRunRecord; cases: TestCaseRunRecord[] } | null {
    return this.delegate.getRunById(id);
  }

  getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[] {
    return this.delegate.getCaseHistory(caseName, project, limit, suiteId);
  }

  getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[] {
    return this.delegate.getRunsInDateRange(project, fromMs, toMs);
  }

  getCasesForRun(runId: string): TestCaseRunRecord[] {
    return this.delegate.getCasesForRun(runId);
  }

  getDistinctCaseNames(project: string, options?: { suiteId?: string; limit?: number }): string[] {
    return this.delegate.getDistinctCaseNames(project, options);
  }

  cleanup(project: string, maxAge: string, maxRuns: number): number {
    return this.delegate.cleanup(project, maxAge, maxRuns);
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

