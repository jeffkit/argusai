/**
 * Unit tests for argus_rebuild tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleRebuild } from '../../../src/tools/rebuild.js';
import type { E2EConfig } from 'argusai-core';

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    loadConfig: vi.fn(),
    buildImage: vi.fn(),
    dockerExec: vi.fn(),
    ensureNetwork: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn().mockResolvedValue('abc123'),
    waitForHealthy: vi.fn().mockResolvedValue(true),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeNetwork: vi.fn().mockResolvedValue(undefined),
    isPortInUse: vi.fn().mockResolvedValue(false),
    findContainersByLabel: vi.fn().mockResolvedValue([]),
    createMockServer: vi.fn().mockReturnValue({
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    parseTime: vi.fn().mockImplementation((t: string) => {
      if (t.endsWith('s')) return parseInt(t) * 1000;
      return parseInt(t);
    }),
  };
});

const { loadConfig, buildImage } = await import('argusai-core');

const testConfig: E2EConfig = {
  version: '1',
  project: { name: 'rebuild-test' },
  service: {
    build: { dockerfile: '/test/rebuild/Dockerfile', context: '/test/rebuild', image: 'rebuild:latest' },
    container: {
      name: 'rebuild-app',
      ports: ['3000:3000'],
      healthcheck: { path: '/health', interval: '10s', timeout: '5s', retries: 3, startPeriod: '10s' },
    },
  },
  network: { name: 'rebuild-net' },
  resilience: {
    preflight: { enabled: false },
    circuitBreaker: { enabled: false },
  },
} as E2EConfig;

describe('handleRebuild', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(testConfig);
    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_end', success: true, duration: 100, timestamp: Date.now() };
    } as any);
  });

  it('should execute all four steps: clean → init → build → setup (#9)', async () => {
    const result = await handleRebuild(
      { projectPath: '/test/rebuild' },
      sessionManager,
    );

    expect(result.steps.clean.success).toBe(true);
    expect(result.steps.init.success).toBe(true);
    expect(result.steps.build.success).toBe(true);
    expect(result.steps.setup.success).toBe(true);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('should succeed even if no session exists for clean step', async () => {
    const result = await handleRebuild(
      { projectPath: '/test/rebuild' },
      sessionManager,
    );

    expect(result.steps.clean.success).toBe(true);
  });

  it('should stop on init failure and return partial result', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('Config not found'));

    const result = await handleRebuild(
      { projectPath: '/test/rebuild' },
      sessionManager,
    );

    expect(result.steps.clean.success).toBe(true);
    expect(result.steps.init.success).toBe(false);
    expect(result.steps.init.error).toContain('Configuration file not found');
    expect(result.steps.build.success).toBe(false);
    expect(result.steps.setup.success).toBe(false);
  });

  it('should stop on build failure and return partial result', async () => {
    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_end', success: false, duration: 100, error: 'Build failed', timestamp: Date.now() };
    } as any);

    const result = await handleRebuild(
      { projectPath: '/test/rebuild' },
      sessionManager,
    );

    expect(result.steps.init.success).toBe(true);
    expect(result.steps.build.success).toBe(false);
    expect(result.steps.setup.success).toBe(false);
  });
});
