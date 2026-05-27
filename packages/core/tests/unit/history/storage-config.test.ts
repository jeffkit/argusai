/**
 * Unit tests for configurable storage modes, retention policies,
 * graceful degradation, and default config behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createHistoryStore,
  SQLiteHistoryStore,
  NoopHistoryStore,
} from '../../../src/history/history-store.js';
import { MemoryHistoryStore } from '../../../src/history/memory-history-store.js';
import { DrizzleHistoryStore } from '../../../src/db/drizzle-history-store.js';
import type { HistoryConfig, TestRunRecord, TestCaseRunRecord } from '../../../src/history/types.js';

function makeConfig(overrides?: Partial<HistoryConfig>): HistoryConfig {
  return {
    enabled: true,
    storage: 'local',
    retention: { maxAge: '90d', maxRuns: 1000 },
    flakyWindow: 10,
    ...overrides,
  };
}

function makeRun(id: string, ts: number, project = 'test-project'): TestRunRecord {
  return {
    id, project, timestamp: ts,
    gitCommit: 'abc', gitBranch: 'main', configHash: 'sha256:test',
    trigger: 'cli', duration: 5000, passed: 10, failed: 0, skipped: 0,
    flaky: 0, status: 'passed',
  };
}

function makeCase(runId: string, caseName: string): TestCaseRunRecord {
  return {
    id: `case-${runId}-${caseName}`, runId, suiteId: 'api', caseName,
    status: 'passed', duration: 100, attempts: 1,
    responseMs: null, assertions: null, error: null, snapshot: null,
  };
}

describe('createHistoryStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return DrizzleHistoryStore for local mode', () => {
    const config = makeConfig({ storage: 'local' });
    const store = createHistoryStore(config, tmpDir);
    expect(store).toBeInstanceOf(DrizzleHistoryStore);
    store.close();
  });

  it('should create SQLite file at configured path', () => {
    const customPath = path.join(tmpDir, 'custom', 'test.db');
    const config = makeConfig({ storage: 'local', path: 'custom/test.db' });
    const store = createHistoryStore(config, tmpDir);
    expect(fs.existsSync(customPath)).toBe(true);
    store.close();
  });

  it('should return MemoryHistoryStore for memory mode', () => {
    const config = makeConfig({ storage: 'memory' });
    const store = createHistoryStore(config, tmpDir);
    expect(store).toBeInstanceOf(MemoryHistoryStore);
    store.close();
  });

  it('should return NoopHistoryStore when enabled is false', () => {
    const config = makeConfig({ enabled: false });
    const store = createHistoryStore(config, tmpDir);
    expect(store).toBeInstanceOf(NoopHistoryStore);
    store.close();
  });

  it('should fall back to MemoryHistoryStore on corrupted DB path', () => {
    const badPath = path.join(tmpDir, 'bad.db');
    fs.writeFileSync(badPath, 'not a sqlite file');
    const config = makeConfig({ storage: 'local', path: 'bad.db' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createHistoryStore(config, tmpDir);
    expect(store).toBeInstanceOf(MemoryHistoryStore);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    store.close();
  });

  it('should use default path .argusai/history.db when path not specified', () => {
    const config = makeConfig({ storage: 'local' });
    delete (config as Record<string, unknown>)['path'];
    const store = createHistoryStore(config, tmpDir);
    const expectedPath = path.join(tmpDir, '.argusai', 'history.db');
    expect(fs.existsSync(expectedPath)).toBe(true);
    store.close();
  });
});

describe('NoopHistoryStore', () => {
  it('should return empty results for all queries', () => {
    const store = new NoopHistoryStore();
    expect(store.getRuns('p', {})).toEqual({ runs: [], total: 0 });
    expect(store.getRunById('x')).toBeNull();
    expect(store.getCaseHistory('c', 'p', 10)).toEqual([]);
    expect(store.getRunsInDateRange('p', 0, Date.now())).toEqual([]);
    expect(store.getCasesForRun('r')).toEqual([]);
    expect(store.getDistinctCaseNames('p')).toEqual([]);
    expect(store.cleanup('p', '90d', 1000)).toBe(0);
  });

  it('should not throw on saveRun or close', () => {
    const store = new NoopHistoryStore();
    expect(() => store.saveRun(makeRun('r1', Date.now()), [])).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });
});

describe('retention cleanup: time-based', () => {
  let store: MemoryHistoryStore;

  beforeEach(() => {
    store = new MemoryHistoryStore();
  });

  it('should remove records older than maxAge', () => {
    const now = Date.now();
    const old = now - 100 * 24 * 60 * 60 * 1000;
    const recent = now - 1 * 24 * 60 * 60 * 1000;

    store.saveRun(makeRun('old-run', old), [makeCase('old-run', 'case1')]);
    store.saveRun(makeRun('recent-run', recent), [makeCase('recent-run', 'case1')]);

    const deleted = store.cleanup('test-project', '90d', 1000);
    expect(deleted).toBe(1);

    const result = store.getRuns('test-project', {});
    expect(result.total).toBe(1);
    expect(result.runs[0]!.id).toBe('recent-run');
  });

  it('should not delete records within maxAge', () => {
    const now = Date.now();
    store.saveRun(makeRun('r1', now - 10 * 86400000), []);
    store.saveRun(makeRun('r2', now - 5 * 86400000), []);

    const deleted = store.cleanup('test-project', '30d', 1000);
    expect(deleted).toBe(0);
    expect(store.getRuns('test-project', {}).total).toBe(2);
  });
});

describe('retention cleanup: count-based', () => {
  let store: MemoryHistoryStore;

  beforeEach(() => {
    store = new MemoryHistoryStore();
  });

  it('should keep only maxRuns most recent records', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.saveRun(makeRun(`run-${i}`, now + i * 1000), []);
    }

    const deleted = store.cleanup('test-project', '365d', 3);
    expect(deleted).toBe(2);

    const result = store.getRuns('test-project', {});
    expect(result.total).toBe(3);
    expect(result.runs[0]!.id).toBe('run-4');
  });

  it('should not delete when count is within limit', () => {
    const now = Date.now();
    store.saveRun(makeRun('r1', now), []);
    store.saveRun(makeRun('r2', now + 1000), []);

    const deleted = store.cleanup('test-project', '365d', 10);
    expect(deleted).toBe(0);
  });
});

describe('default config values', () => {
  it('should work with HistoryConfigSchema defaults when no history section', async () => {
    const { HistoryConfigSchema } = await import('../../../src/config-loader.js');
    const config = HistoryConfigSchema.parse({});
    expect(config.enabled).toBe(true);
    expect(config.storage).toBe('local');
    expect(config.retention.maxAge).toBe('90d');
    expect(config.retention.maxRuns).toBe(1000);
    expect(config.flakyWindow).toBe(10);
  });

  it('should work with undefined input to HistoryConfigSchema', async () => {
    const { HistoryConfigSchema } = await import('../../../src/config-loader.js');
    const config = HistoryConfigSchema.parse(undefined);
    expect(config.enabled).toBe(true);
    expect(config.storage).toBe('local');
  });
});
