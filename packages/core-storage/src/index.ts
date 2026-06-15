/**
 * @module argusai-core-storage
 *
 * Storage layer for ArgusAI — SQLite/Drizzle history, knowledge base,
 * and team sync. Extracted from argusai-core as an independent package
 * following the Strangler Fig pattern.
 *
 * argusai-core re-exports everything from this package for backward
 * compatibility. New consumers should import directly from here.
 */

// ── History ────────────────────────────────────────────────────────────────
export * from './history/types.js';
export type { HistoryStore, GetRunsOptions, GetRunsResult, DrizzleHistoryStoreWithDb } from './history/history-store.js';
export { SQLiteHistoryStore, NoopHistoryStore, createHistoryStore } from './history/history-store.js';
export { MemoryHistoryStore } from './history/memory-history-store.js';
export { HistoryRecorder } from './history/history-recorder.js';
export type { SuiteRunResult, RunInput, RecordRunResult } from './history/history-recorder.js';
export { getGitContext } from './history/git-context.js';
export type { GitContext } from './history/git-context.js';
export { computeConfigHash } from './history/config-hash.js';
export { applyMigrations } from './history/migrations.js';
export { FlakyDetector } from './history/flaky-detector.js';

// ── Knowledge ──────────────────────────────────────────────────────────────
export type {
  FailureCategory,
  FailureEvent,
  ClassificationRule,
  FailurePattern,
  FixRecord,
  DiagnosticResult,
  ReportFixResult,
  KnowledgeStore,
} from './knowledge/types.js';
export { FailureClassifier, DEFAULT_RULES, createDefaultClassifier } from './knowledge/classifier.js';
export { normalizeError, generateSignature } from './knowledge/normalizer.js';
export { SQLiteKnowledgeStore, NoopKnowledgeStore } from './knowledge/knowledge-store.js';
export { BUILT_IN_PATTERNS } from './knowledge/built-in-patterns.js';
export { DiagnosticsEngine } from './knowledge/diagnostics-engine.js';

// ── Database (Drizzle/SQLite) ───────────────────────────────────────────────
export { createDb, createSqliteDbFromDatabase } from './db/create-db.js';
export type { DbConfig, DbDialect, SqliteDb, AnyDb } from './db/create-db.js';
export { DrizzleHistoryStore } from './db/drizzle-history-store.js';
export { DrizzleKnowledgeStore } from './db/drizzle-knowledge-store.js';
export * as sqliteSchema from './db/schema-sqlite.js';
export * as pgSchema from './db/schema-pg.js';
export * as mysqlSchema from './db/schema-mysql.js';

// ── Sync ───────────────────────────────────────────────────────────────────
export { SyncQueue } from './sync/sync-queue.js';
export type { SyncQueueEntry, SyncQueueStats } from './sync/sync-queue.js';
export { SyncClient } from './sync/sync-client.js';
export type {
  SyncRunsPayload,
  SyncRunsResponse,
  SyncPatternsPayload,
  SyncPatternsResponse,
} from './sync/sync-client.js';
export { SyncManager } from './sync/sync-manager.js';
export type { SyncStatus, SyncResult } from './sync/sync-manager.js';
export { RemoteHistoryStore } from './sync/remote-history-store.js';
export type { SyncPattern } from './sync/remote-history-store.js';
