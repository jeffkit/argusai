import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as sqliteSchema from '../../../src/db/schema-sqlite.js';
import { SyncQueue } from '../../../src/sync/sync-queue.js';
import { applyMigrations } from '../../../src/history/migrations.js';

describe('SyncQueue', () => {
  let queue: SyncQueue;

  beforeEach(() => {
    const raw = new Database(':memory:');
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    applyMigrations(raw);
    const db = drizzle(raw, { schema: sqliteSchema });
    queue = new SyncQueue(db);
  });

  it('should enqueue and retrieve pending entries', () => {
    const id = queue.enqueue('run', { project: 'test', data: 'hello' });
    expect(id).toBeDefined();

    const pending = queue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(id);
    expect(pending[0]!.type).toBe('run');
    expect(pending[0]!.status).toBe('pending');
    expect(JSON.parse(pending[0]!.payload)).toEqual({ project: 'test', data: 'hello' });
  });

  it('should respect getPending limit', () => {
    for (let i = 0; i < 10; i++) {
      queue.enqueue('run', { i });
    }
    const pending = queue.getPending(3);
    expect(pending).toHaveLength(3);
  });

  it('should order pending by created_at ASC', () => {
    const id1 = queue.enqueue('run', { order: 1 });
    const id2 = queue.enqueue('run', { order: 2 });
    const id3 = queue.enqueue('run', { order: 3 });

    const pending = queue.getPending();
    expect(pending[0]!.id).toBe(id1);
    expect(pending[1]!.id).toBe(id2);
    expect(pending[2]!.id).toBe(id3);
  });

  it('should mark entry as sending', () => {
    const id = queue.enqueue('run', { test: true });
    queue.markSending(id);

    const pending = queue.getPending();
    expect(pending).toHaveLength(0);

    const stats = queue.getStats();
    expect(stats.sending).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it('should mark entry as completed', () => {
    const id = queue.enqueue('run', { test: true });
    queue.markSending(id);
    queue.markCompleted(id);

    const stats = queue.getStats();
    expect(stats.sending).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.total).toBe(1);
  });

  it('should mark entry as failed with exponential backoff', () => {
    const id = queue.enqueue('run', { test: true });

    queue.markFailed(id, 'Connection timeout');

    const pending = queue.getPending();
    expect(pending).toHaveLength(0); // nextRetryAt is in the future

    const stats = queue.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('should mark as permanently failed after max retries', () => {
    const id = queue.enqueue('run', { test: true });

    for (let i = 0; i < 10; i++) {
      queue.markFailed(id, `Attempt ${i + 1} failed`);
    }

    const stats = queue.getStats();
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it('should return correct stats', () => {
    queue.enqueue('run', { a: 1 });
    queue.enqueue('patterns', { b: 2 });
    const id3 = queue.enqueue('run', { c: 3 });
    queue.markSending(id3);

    const stats = queue.getStats();
    expect(stats.pending).toBe(2);
    expect(stats.sending).toBe(1);
    expect(stats.total).toBe(3);
  });

  it('should cleanup completed entries', () => {
    const id1 = queue.enqueue('run', { a: 1 });
    const id2 = queue.enqueue('run', { b: 2 });
    queue.markCompleted(id1);

    const cleaned = queue.cleanup();
    expect(cleaned).toBe(1);

    const stats = queue.getStats();
    expect(stats.total).toBe(1);
  });
});
