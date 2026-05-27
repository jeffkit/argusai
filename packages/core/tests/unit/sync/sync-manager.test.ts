import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../../src/sync/sync-manager.js';
import type { SyncQueue, SyncQueueEntry } from '../../../src/sync/sync-queue.js';
import type { SyncClient } from '../../../src/sync/sync-client.js';

function createMockQueue(): SyncQueue {
  return {
    enqueue: vi.fn(),
    getPending: vi.fn().mockReturnValue([]),
    markSending: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    getStats: vi.fn().mockReturnValue({ pending: 0, sending: 0, failed: 0, total: 0 }),
    cleanup: vi.fn(),
  } as unknown as SyncQueue;
}

function createMockClient(): SyncClient {
  return {
    syncRuns: vi.fn().mockResolvedValue({ success: true, result: {} }),
    syncPatterns: vi.fn().mockResolvedValue({ success: true, result: {} }),
    ping: vi.fn().mockResolvedValue(true),
  } as unknown as SyncClient;
}

function createEntry(overrides: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    id: 'entry-1',
    payload: JSON.stringify({ project: 'test', team: 'team', run: {}, cases: [] }),
    type: 'run',
    status: 'pending',
    attempts: 0,
    maxRetries: 10,
    createdAt: new Date().toISOString(),
    nextRetryAt: new Date().toISOString(),
    lastError: null,
    ...overrides,
  };
}

describe('SyncManager', () => {
  let queue: SyncQueue;
  let client: SyncClient;

  beforeEach(() => {
    queue = createMockQueue();
    client = createMockClient();
  });

  it('should drain queue on syncNow', async () => {
    const entry = createEntry();
    (queue.getPending as any)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce([]);

    const manager = new SyncManager(queue, client);
    const result = await manager.syncNow();

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(queue.markSending).toHaveBeenCalledWith('entry-1');
    expect(queue.markCompleted).toHaveBeenCalledWith('entry-1');
    expect(client.syncRuns).toHaveBeenCalled();
  });

  it('should handle sync failure gracefully', async () => {
    const entry = createEntry();
    (queue.getPending as any)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce([]);
    (client.syncRuns as any).mockRejectedValueOnce(new Error('Network error'));

    const manager = new SyncManager(queue, client);
    const result = await manager.syncNow();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toContain('Network error');
    expect(queue.markFailed).toHaveBeenCalledWith('entry-1', 'Network error');
  });

  it('should call syncPatterns for patterns type', async () => {
    const entry = createEntry({
      type: 'patterns',
      payload: JSON.stringify({ project: 'test', team: 'team', patterns: [] }),
    });
    (queue.getPending as any)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce([]);

    const manager = new SyncManager(queue, client);
    await manager.syncNow();

    expect(client.syncPatterns).toHaveBeenCalled();
    expect(client.syncRuns).not.toHaveBeenCalled();
  });

  it('should report correct status', () => {
    (queue.getStats as any).mockReturnValue({ pending: 3, sending: 1, failed: 2, total: 6 });

    const manager = new SyncManager(queue, client);
    const status = manager.getStatus();

    expect(status.pending).toBe(3);
    expect(status.sending).toBe(1);
    expect(status.failed).toBe(2);
    expect(status.lastSyncAt).toBeNull();
    expect(status.lastError).toBeNull();
  });

  it('should start and stop background timer', () => {
    const manager = new SyncManager(queue, client, 100);
    manager.start();
    manager.stop();
    // Should not throw
  });
});
