import type { SyncQueue } from './sync-queue.js';
import type { SyncClient } from './sync-client.js';

export interface SyncStatus {
  pending: number;
  sending: number;
  failed: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

/**
 * Orchestrates the sync lifecycle: background timer + manual trigger.
 * Processes the SyncQueue by sending pending entries to the server.
 */
export class SyncManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private processing = false;

  constructor(
    private syncQueue: SyncQueue,
    private syncClient: SyncClient,
    private intervalMs = 30000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processQueue().catch(() => { /* swallow — errors logged internally */ });
    }, this.intervalMs);
    // Unref so the timer doesn't keep the process alive
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncNow(): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, failed: 0, errors: [] };
    let hasMore = true;

    while (hasMore) {
      const entries = this.syncQueue.getPending(5);
      if (entries.length === 0) {
        hasMore = false;
        break;
      }

      for (const entry of entries) {
        try {
          this.syncQueue.markSending(entry.id);
          const payload = JSON.parse(entry.payload);

          if (entry.type === 'run') {
            await this.syncClient.syncRuns(payload);
          } else {
            await this.syncClient.syncPatterns(payload);
          }

          this.syncQueue.markCompleted(entry.id);
          result.synced++;
          this.lastSyncAt = new Date().toISOString();
          this.lastError = null;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.syncQueue.markFailed(entry.id, errorMsg);
          result.failed++;
          result.errors.push(errorMsg);
          this.lastError = errorMsg;
        }
      }
    }

    return result;
  }

  getStatus(): SyncStatus {
    const stats = this.syncQueue.getStats();
    return {
      pending: stats.pending,
      sending: stats.sending,
      failed: stats.failed,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const entries = this.syncQueue.getPending(5);

      for (const entry of entries) {
        try {
          this.syncQueue.markSending(entry.id);
          const payload = JSON.parse(entry.payload);

          if (entry.type === 'run') {
            await this.syncClient.syncRuns(payload);
          } else {
            await this.syncClient.syncPatterns(payload);
          }

          this.syncQueue.markCompleted(entry.id);
          this.lastSyncAt = new Date().toISOString();
          this.lastError = null;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.syncQueue.markFailed(entry.id, errorMsg);
          this.lastError = errorMsg;
          console.warn(`[sync] Failed to sync entry ${entry.id}: ${errorMsg}`);
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
