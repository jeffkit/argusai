/**
 * @module history
 * Test result persistence & trend analysis subsystem.
 */

export * from './types.js';
export type { HistoryStore, GetRunsOptions, GetRunsResult, DrizzleHistoryStoreWithDb } from './history-store.js';
export { SQLiteHistoryStore, NoopHistoryStore, createHistoryStore } from './history-store.js';
export { MemoryHistoryStore } from './memory-history-store.js';
export { HistoryRecorder } from './history-recorder.js';
export type { SuiteRunResult, RunInput, RecordRunResult } from './history-recorder.js';
export { getGitContext } from './git-context.js';
export type { GitContext } from './git-context.js';
export { computeConfigHash } from './config-hash.js';
export { applyMigrations } from './migrations.js';
export { FlakyDetector } from './flaky-detector.js';
