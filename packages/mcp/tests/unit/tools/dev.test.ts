/**
 * Unit tests for argus_dev tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleDev } from '../../../src/tools/dev.js';
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
    // Port-conflict resolution dials real host ports, which makes this unit
    // test fail whenever an unrelated process holds e.g. 8080. Stub it to a
    // pass-through so the test only exercises handleDev.
    PortResolver: class {
      async resolveServicePorts(
        services: unknown[],
        mocks: Record<string, unknown>,
      ): Promise<{ services: unknown[]; mocks: Record<string, unknown>; portMappings: never[] }> {
        return { services, mocks, portMappings: [] };
      }
    },
    findContainersByLabel: vi.fn().mockResolvedValue([]),
    getContainerStatus: vi.fn().mockResolvedValue('running'),
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

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    execFileSync: vi.fn().mockReturnValue('[{}]'),
  };
});

const { loadConfig, buildImage, isPortInUse } = await import('argusai-core');

const testConfig: E2EConfig = {
  version: '1',
  project: { name: 'dev-test' },
  service: {
    build: { dockerfile: '/test/dev/Dockerfile', context: '/test/dev', image: 'dev:latest' },
    container: {
      name: 'dev-app',
      ports: ['8080:3000'],
      healthcheck: { path: '/health', interval: '10s', timeout: '5s', retries: 3, startPeriod: '10s' },
    },
  },
  network: { name: 'dev-net' },
  resilience: {
    preflight: { enabled: false },
    circuitBreaker: { enabled: false },
  },
} as E2EConfig;

const testConfigWithMocks: E2EConfig = {
  ...testConfig,
  mocks: {
    'payment-api': {
      port: 9081,
      routes: [
        { method: 'POST', path: '/charge', response: { status: 200, body: { ok: true } } },
        { method: 'GET', path: '/status', response: { status: 200, body: { status: 'active' } } },
      ],
    } as any,
  },
} as E2EConfig;

describe('handleDev', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(testConfig);
    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_end', success: true, duration: 100, timestamp: Date.now() };
    } as any);
  });

  it('should init, build, and setup the project in one step', async () => {
    const result = await handleDev(
      { projectPath: '/test/dev' },
      sessionManager,
    );

    expect(result.status).toBe('ready');
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0]!.name).toBe('dev-app');
    expect(result.endpoints[0]!.url).toBe('http://localhost:8080');
    expect(result.endpoints[0]!.healthCheck).toBe('http://localhost:8080/health');
    expect(result.details.reusedSession).toBe(false);
    expect(result.details.skippedBuild).toBe(false);
    expect(result.details.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('should include hints with access URL and cleanup reminder', async () => {
    const result = await handleDev(
      { projectPath: '/test/dev' },
      sessionManager,
    );

    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints.some(h => h.includes('http://localhost:8080'))).toBe(true);
    expect(result.hints.some(h => h.includes('argus_clean'))).toBe(true);
  });

  it('should include mock service info', async () => {
    vi.mocked(loadConfig).mockResolvedValue(testConfigWithMocks);

    const result = await handleDev(
      { projectPath: '/test/dev-mocks' },
      sessionManager,
    );

    expect(result.status).toBe('ready');
    expect(result.mocks).toHaveLength(1);
    expect(result.mocks[0]!.name).toBe('payment-api');
    expect(result.mocks[0]!.url).toBe('http://localhost:9081');
    expect(result.mocks[0]!.routeCount).toBe(2);
    expect(result.hints.some(h => h.includes('payment-api'))).toBe(true);
  });

  it('should reuse an existing healthy session', async () => {
    // First: set up a running session manually
    const session = sessionManager.create('/test/dev-reuse', testConfig, '/test/dev-reuse/e2e.yaml');
    session.containerIds.set('dev-app', 'existing-abc');
    sessionManager.transition('/test/dev-reuse', 'built');
    sessionManager.transition('/test/dev-reuse', 'running');

    // isPortInUse returns true (port accessible)
    vi.mocked(isPortInUse).mockResolvedValue(true);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 0 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await handleDev(
      { projectPath: '/test/dev-reuse' },
      sessionManager,
    );

    expect(result.details.reusedSession).toBe(true);
    expect(result.details.buildDuration).toBe(0);
    expect(result.details.setupDuration).toBe(0);
    expect(result.endpoints).toHaveLength(1);

    fetchSpy.mockRestore();
  });

  it('should skip build when skipBuild is true', async () => {
    // Pre-build: init + build manually, then clean session for re-init
    const result = await handleDev(
      { projectPath: '/test/dev-skipbuild', skipBuild: true },
      sessionManager,
    );

    // Build should be skipped
    expect(result.details.skippedBuild).toBe(true);
    expect(result.details.buildDuration).toBe(0);
  });

  it('should return failed status on init error', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('file not found'));

    const result = await handleDev(
      { projectPath: '/test/dev-fail-init' },
      sessionManager,
    );

    expect(result.status).toBe('failed');
    expect(result.endpoints).toEqual([]);
    expect(result.hints[0]).toContain('初始化失败');
  });

  it('should return failed status on build error', async () => {
    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_end', success: false, duration: 100, error: 'Build failed', timestamp: Date.now() };
    } as any);

    const result = await handleDev(
      { projectPath: '/test/dev-fail-build' },
      sessionManager,
    );

    expect(result.status).toBe('failed');
    expect(result.hints.some(h => h.includes('构建失败') || h.includes('Docker'))).toBe(true);
    expect(result.details.skippedBuild).toBe(false);
  });

  it('should clean unhealthy session and restart', async () => {
    // Create a session in "running" state but ports not accessible
    const session = sessionManager.create('/test/dev-unhealthy', testConfig, '/test/dev-unhealthy/e2e.yaml');
    session.containerIds.set('dev-app', 'dead-container');
    sessionManager.transition('/test/dev-unhealthy', 'built');
    sessionManager.transition('/test/dev-unhealthy', 'running');

    // isPortInUse returns false (port not accessible → unhealthy)
    vi.mocked(isPortInUse).mockResolvedValueOnce(false);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));

    const result = await handleDev(
      { projectPath: '/test/dev-unhealthy' },
      sessionManager,
    );

    // Should have cleaned and rebuilt
    expect(result.details.reusedSession).toBe(false);

    fetchSpy.mockRestore();
  });
});
