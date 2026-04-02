/**
 * Unit tests for cli-context module.
 *
 * Tests the one-shot context creation that CLI commands use
 * to access history & knowledge stores.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('argusai-core', async () => {
  const actual = await vi.importActual<typeof import('argusai-core')>('argusai-core');

  const mockDb = {
    pragma: vi.fn(),
    prepare: vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn(), all: vi.fn() }),
    exec: vi.fn(),
    transaction: vi.fn((fn: Function) => fn),
  };

  class MockSQLiteHistoryStore {
    closed = false;
    getDatabase() { return mockDb; }
    close() { this.closed = true; }
  }

  class MockSQLiteKnowledgeStore {
    closed = false;
    constructor(_db: unknown) {}
    close() { this.closed = true; }
  }

  class MockNoopKnowledgeStore {
    close() {}
  }

  return {
    ...actual,
    loadConfig: vi.fn(),
    createHistoryStore: vi.fn(),
    SQLiteHistoryStore: MockSQLiteHistoryStore,
    SQLiteKnowledgeStore: MockSQLiteKnowledgeStore,
    NoopKnowledgeStore: MockNoopKnowledgeStore,
  };
});

import { createCliContext, type CliContext } from '../src/cli-context.js';
import { loadConfig, createHistoryStore, SQLiteHistoryStore } from 'argusai-core';

const mockLoadConfig = vi.mocked(loadConfig);
const mockCreateHistoryStore = vi.mocked(createHistoryStore);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCliContext', () => {
  const baseConfig = {
    version: '1',
    project: { name: 'test-project' },
    service: {
      build: { image: 'test:latest', dockerfile: './Dockerfile', context: '.' },
      container: { name: 'test-e2e', ports: ['8080:8080'] },
    },
    history: {
      enabled: true,
      storage: 'local' as const,
      retention: { maxAge: '90d', maxRuns: 1000 },
      flakyWindow: 10,
    },
  };

  it('should create context with history and knowledge stores when history is enabled', async () => {
    mockLoadConfig.mockResolvedValue(baseConfig as any);
    const mockStore = new SQLiteHistoryStore('' as any);
    mockCreateHistoryStore.mockReturnValue(mockStore as any);

    const ctx = await createCliContext();

    expect(ctx.config).toBe(baseConfig);
    expect(ctx.projectPath).toBeTruthy();
    expect(ctx.historyStore).toBeDefined();
    expect(ctx.knowledgeStore).toBeDefined();

    ctx.close();
  });

  it('should create context without stores when history is disabled', async () => {
    const disabledConfig = {
      ...baseConfig,
      history: { ...baseConfig.history, enabled: false },
    };
    mockLoadConfig.mockResolvedValue(disabledConfig as any);

    const ctx = await createCliContext();

    expect(ctx.historyStore).toBeUndefined();
    expect(ctx.knowledgeStore).toBeUndefined();

    ctx.close();
  });

  it('should create context without stores when no history config exists', async () => {
    const noHistoryConfig = { ...baseConfig, history: undefined };
    mockLoadConfig.mockResolvedValue(noHistoryConfig as any);
    mockCreateHistoryStore.mockReturnValue({
      close: vi.fn(),
    } as any);

    const ctx = await createCliContext();
    expect(ctx.config).toBe(noHistoryConfig);
    ctx.close();
  });

  it('should propagate loadConfig errors', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Config not found'));

    await expect(createCliContext()).rejects.toThrow('Config not found');
  });

  it('should degrade gracefully if history store init fails', async () => {
    mockLoadConfig.mockResolvedValue(baseConfig as any);
    mockCreateHistoryStore.mockImplementation(() => {
      throw new Error('SQLite unavailable');
    });

    const ctx = await createCliContext();

    expect(ctx.historyStore).toBeUndefined();
    expect(ctx.knowledgeStore).toBeUndefined();

    ctx.close();
  });

  it('close() should not throw even if stores have errors', async () => {
    mockLoadConfig.mockResolvedValue(baseConfig as any);
    const errorStore = {
      close() { throw new Error('close failed'); },
      getDatabase() { return {}; },
    };
    mockCreateHistoryStore.mockReturnValue(errorStore as any);

    const ctx = await createCliContext();
    expect(() => ctx.close()).not.toThrow();
  });
});
