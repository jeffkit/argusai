import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as sqliteSchema from '../../../src/db/schema-sqlite.js';
import { DrizzleHistoryStore } from '../../../src/db/drizzle-history-store.js';
import { SyncQueue } from '../../../src/sync/sync-queue.js';
import { RemoteHistoryStore } from '../../../src/sync/remote-history-store.js';
import { applyMigrations } from '../../../src/history/migrations.js';
import type { TestRunRecord, TestCaseRunRecord } from '../../../src/history/types.js';
import type { ServerConfig } from '../../../src/types.js';

function createTestRun(id = 'run-1'): TestRunRecord {
  return {
    id,
    project: 'test-project',
    timestamp: Date.now(),
    gitCommit: 'abc123',
    gitBranch: 'main',
    configHash: 'hash',
    trigger: 'cli',
    duration: 1000,
    passed: 5,
    failed: 1,
    skipped: 0,
    flaky: 0,
    status: 'failed',
  };
}

function createTestCase(runId = 'run-1'): TestCaseRunRecord {
  return {
    id: 'case-1',
    runId,
    suiteId: 'suite-1',
    caseName: 'test-case',
    status: 'passed',
    duration: 100,
    attempts: 1,
    responseMs: null,
    assertions: null,
    error: null,
    snapshot: null,
  };
}

describe('RemoteHistoryStore', () => {
  let localStore: DrizzleHistoryStore;
  let syncQueue: SyncQueue;
  let remoteStore: RemoteHistoryStore;
  const serverConfig: ServerConfig = {
    url: 'https://server.example.com',
    apiKey: 'test-key',
    team: 'my-team',
    sync: 'auto',
  };

  beforeEach(() => {
    const raw = new Database(':memory:');
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    applyMigrations(raw);
    const db = drizzle(raw, { schema: sqliteSchema });
    localStore = new DrizzleHistoryStore(db);
    syncQueue = new SyncQueue(db);
    remoteStore = new RemoteHistoryStore(localStore, syncQueue, serverConfig);
  });

  it('should save run locally AND enqueue sync', () => {
    const run = createTestRun();
    const cases = [createTestCase()];

    remoteStore.saveRun(run, cases);

    // Verify local write
    const result = localStore.getRunById('run-1');
    expect(result).not.toBeNull();
    expect(result!.run.id).toBe('run-1');
    expect(result!.cases).toHaveLength(1);

    // Verify sync enqueued
    const pending = syncQueue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.type).toBe('run');

    const payload = JSON.parse(pending[0]!.payload);
    expect(payload.project).toBe('test-project');
    expect(payload.team).toBe('my-team');
    expect(payload.run.id).toBe('run-1');
    expect(payload.cases).toHaveLength(1);
  });

  it('should delegate read methods to local store', () => {
    const run = createTestRun();
    const cases = [createTestCase()];
    remoteStore.saveRun(run, cases);

    const runs = remoteStore.getRuns('test-project', { limit: 10 });
    expect(runs.runs).toHaveLength(1);

    const byId = remoteStore.getRunById('run-1');
    expect(byId).not.toBeNull();

    const caseHistory = remoteStore.getCaseHistory('test-case', 'test-project', 10);
    expect(caseHistory).toHaveLength(1);
  });

  it('should not fail saveRun if enqueue throws', () => {
    const brokenQueue = {
      enqueue: vi.fn(() => { throw new Error('DB full'); }),
    } as unknown as SyncQueue;
    const store = new RemoteHistoryStore(localStore, brokenQueue, serverConfig);

    const run = createTestRun('run-2');
    const cases = [createTestCase('run-2')];

    // Should not throw
    store.saveRun(run, cases);

    // Local write should still succeed
    const result = localStore.getRunById('run-2');
    expect(result).not.toBeNull();
  });
});
