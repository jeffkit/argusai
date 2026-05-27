import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteHistoryStore } from '../../../src/sync/remote-history-store.js';
import type { HistoryStore } from '../../../src/history/history-store.js';
import type { SyncQueue } from '../../../src/sync/sync-queue.js';
import type { ServerConfig } from '../../../src/types.js';

function makeMockLocalStore(): HistoryStore {
  return {
    saveRun: vi.fn(),
    getRuns: vi.fn().mockReturnValue({ runs: [], total: 0 }),
    getRunById: vi.fn().mockReturnValue(null),
    getCaseHistory: vi.fn().mockReturnValue([]),
    getRunsInDateRange: vi.fn().mockReturnValue([]),
    getCasesForRun: vi.fn().mockReturnValue([]),
    getDistinctCaseNames: vi.fn().mockReturnValue([]),
    cleanup: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  } as any;
}

function makeMockSyncQueue(): SyncQueue {
  return {
    enqueue: vi.fn().mockReturnValue('entry-1'),
    getPending: vi.fn().mockReturnValue([]),
    markSending: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
    cleanup: vi.fn(),
  } as any;
}

const serverConfig: ServerConfig = {
  url: 'http://localhost:3000',
  apiKey: 'test-key',
  team: 'test-team',
  sync: 'auto',
};

describe('RemoteHistoryStore diagnostic sync', () => {
  let localStore: HistoryStore;
  let syncQueue: ReturnType<typeof makeMockSyncQueue>;
  let remoteStore: RemoteHistoryStore;

  beforeEach(() => {
    localStore = makeMockLocalStore();
    syncQueue = makeMockSyncQueue();
    remoteStore = new RemoteHistoryStore(localStore, syncQueue, serverConfig);
  });

  it('includes patterns in sync payload when attachPatterns is called', () => {
    const patterns = [
      {
        category: 'CONNECTION_REFUSED',
        signature: 'learned::ECONNREFUSED',
        signaturePattern: 'ECONNREFUSED *',
        description: 'Connection refused',
        suggestedFix: 'Check if service is running',
        confidence: 0.85,
        source: 'learned' as const,
      },
    ];

    remoteStore.attachPatterns(patterns);
    remoteStore.saveRun(
      {
        id: 'run-1',
        project: 'test-project',
        timestamp: Date.now(),
        gitCommit: null,
        gitBranch: null,
        configHash: 'hash',
        trigger: 'cli',
        duration: 1000,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        status: 'passed',
      } as any,
      [],
    );

    expect(syncQueue.enqueue).toHaveBeenCalledTimes(1);
    const [type, payload] = (syncQueue.enqueue as any).mock.calls[0];
    expect(type).toBe('run');
    expect(payload.patterns).toHaveLength(1);
    expect(payload.patterns[0].category).toBe('CONNECTION_REFUSED');
  });

  it('does not include patterns when attachPatterns is not called', () => {
    remoteStore.saveRun(
      {
        id: 'run-2',
        project: 'test-project',
        timestamp: Date.now(),
        gitCommit: null,
        gitBranch: null,
        configHash: 'hash',
        trigger: 'cli',
        duration: 1000,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        status: 'passed',
      } as any,
      [],
    );

    const [, payload] = (syncQueue.enqueue as any).mock.calls[0];
    expect(payload.patterns).toBeUndefined();
  });

  it('clears pending patterns after saveRun', () => {
    const patterns = [
      {
        category: 'TIMEOUT',
        signature: 'learned::TIMEOUT',
        signaturePattern: 'TIMEOUT*',
        description: 'Timeout',
        suggestedFix: 'Increase timeout',
        confidence: 0.5,
        source: 'learned' as const,
      },
    ];

    remoteStore.attachPatterns(patterns);
    remoteStore.saveRun({ id: 'run-3', project: 'p', timestamp: 0, gitCommit: null, gitBranch: null, configHash: 'h', trigger: 'cli', duration: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, status: 'passed' } as any, []);

    // Second call should not have patterns
    remoteStore.saveRun({ id: 'run-4', project: 'p', timestamp: 0, gitCommit: null, gitBranch: null, configHash: 'h', trigger: 'cli', duration: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, status: 'passed' } as any, []);

    const [, payload1] = (syncQueue.enqueue as any).mock.calls[0];
    const [, payload2] = (syncQueue.enqueue as any).mock.calls[1];
    expect(payload1.patterns).toHaveLength(1);
    expect(payload2.patterns).toBeUndefined();
  });
});
