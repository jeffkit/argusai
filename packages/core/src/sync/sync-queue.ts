import { eq, and, lte, asc, count, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SqliteDb } from '../db/create-db.js';
import { syncQueue } from '../db/schema-sqlite.js';

export interface SyncQueueEntry {
  id: string;
  payload: string;
  type: 'run' | 'patterns';
  status: 'pending' | 'sending' | 'completed' | 'failed';
  attempts: number;
  maxRetries: number;
  createdAt: string;
  nextRetryAt: string;
  lastError: string | null;
}

export interface SyncQueueStats {
  pending: number;
  sending: number;
  failed: number;
  total: number;
}

/**
 * Local sync queue backed by the `sync_queue` table in SQLite (via Drizzle).
 * Buffers sync payloads for reliable delivery to the ArgusAI Server.
 */
export class SyncQueue {
  constructor(private db: SqliteDb) {}

  enqueue(type: 'run' | 'patterns', payload: object): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.insert(syncQueue).values({
      id,
      payload: JSON.stringify(payload),
      type,
      status: 'pending',
      attempts: 0,
      maxRetries: 10,
      createdAt: now,
      nextRetryAt: now,
      lastError: null,
    }).run();

    return id;
  }

  getPending(limit = 5): SyncQueueEntry[] {
    const now = new Date().toISOString();

    const rows = this.db
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.status, 'pending'),
          lte(syncQueue.nextRetryAt, now),
        ),
      )
      .orderBy(asc(syncQueue.createdAt))
      .limit(limit)
      .all();

    return rows.map(mapQueueRow);
  }

  markSending(id: string): void {
    this.db
      .update(syncQueue)
      .set({ status: 'sending' })
      .where(eq(syncQueue.id, id))
      .run();
  }

  markCompleted(id: string): void {
    this.db
      .update(syncQueue)
      .set({ status: 'completed' })
      .where(eq(syncQueue.id, id))
      .run();
  }

  markFailed(id: string, error: string): void {
    const row = this.db
      .select({ attempts: syncQueue.attempts, maxRetries: syncQueue.maxRetries })
      .from(syncQueue)
      .where(eq(syncQueue.id, id))
      .get();

    if (!row) return;

    const newAttempts = row.attempts + 1;
    const isPermanentFailure = newAttempts >= row.maxRetries;
    const backoffMs = Math.min(5000 * Math.pow(2, row.attempts), 300000);
    const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

    this.db
      .update(syncQueue)
      .set({
        status: isPermanentFailure ? 'failed' : 'pending',
        attempts: newAttempts,
        nextRetryAt,
        lastError: error,
      })
      .where(eq(syncQueue.id, id))
      .run();
  }

  getStats(): SyncQueueStats {
    const pending = this.db.select({ cnt: count() }).from(syncQueue)
      .where(eq(syncQueue.status, 'pending')).get()?.cnt ?? 0;
    const sending = this.db.select({ cnt: count() }).from(syncQueue)
      .where(eq(syncQueue.status, 'sending')).get()?.cnt ?? 0;
    const failed = this.db.select({ cnt: count() }).from(syncQueue)
      .where(eq(syncQueue.status, 'failed')).get()?.cnt ?? 0;
    const total = this.db.select({ cnt: count() }).from(syncQueue).get()?.cnt ?? 0;

    return { pending, sending, failed, total };
  }

  cleanup(): number {
    const result = this.db
      .delete(syncQueue)
      .where(eq(syncQueue.status, 'completed'))
      .run();
    return result.changes;
  }
}

function mapQueueRow(row: typeof syncQueue.$inferSelect): SyncQueueEntry {
  return {
    id: row.id,
    payload: row.payload,
    type: row.type as 'run' | 'patterns',
    status: row.status as SyncQueueEntry['status'],
    attempts: row.attempts,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
  };
}
