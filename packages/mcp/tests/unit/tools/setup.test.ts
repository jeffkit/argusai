/**
 * Unit tests for argus_setup tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleSetup } from '../../../src/tools/setup.js';
import type { E2EConfig } from 'argusai-core';

// execFile is only used by the image-based mock path (stale check + docker run).
vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    const cb = args.at(-1) as (err: Error | null, result: { stdout: string }) => void;
    cb(null, { stdout: 'abcdef' });
  }),
}));

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile);

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    ensureNetwork: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn().mockResolvedValue('abc123def456'),
    waitForHealthy: vi.fn().mockResolvedValue(true),
    isPortInUse: vi.fn().mockResolvedValue(false),
    getHostPort: vi.fn().mockResolvedValue(49153),
    createMockServer: vi.fn().mockReturnValue({
      listen: vi.fn().mockResolvedValue('http://0.0.0.0:9100'),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    parseTime: vi.fn().mockImplementation((t: string) => {
      if (t.endsWith('s')) return parseInt(t) * 1000;
      return parseInt(t);
    }),
  };
});

const { startContainer, waitForHealthy, isPortInUse, ensureNetwork, getHostPort } = await import('argusai-core');

function setupSession(manager: SessionManager, projectPath = '/test/project'): void {
  const config: E2EConfig = {
    version: '1',
    project: { name: 'test' },
    service: {
      build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
      container: {
        name: 'test-app',
        ports: ['3000:3000'],
        healthcheck: { path: '/health', interval: '10s', timeout: '5s', retries: 10, startPeriod: '30s' },
      },
    },
    mocks: {
      'api-mock': { port: 9100, routes: [{ method: 'GET', path: '/ok', response: { status: 200, body: {} } }] },
    },
    network: { name: 'test-net' },
    resilience: {
      preflight: { enabled: false },
      circuitBreaker: { enabled: false },
    },
  } as E2EConfig;
  manager.create(projectPath, config, `${projectPath}/e2e.yaml`);
  manager.transition(projectPath, 'built');
}

describe('handleSetup', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should setup environment successfully', async () => {
    setupSession(sessionManager);

    const result = await handleSetup({ projectPath: '/test/project' }, sessionManager);

    expect(result.network.name).toBe('test-net');
    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.name).toBe('test-app');
    expect(result.services[0]!.status).toBe('healthy');
    expect(result.mocks).toHaveLength(1);
    expect(result.mocks[0]!.status).toBe('running');
    expect(sessionManager.getOrThrow('/test/project').state).toBe('running');
  });

  it('should throw SESSION_NOT_FOUND without session', async () => {
    await expect(handleSetup({ projectPath: '/missing' }, sessionManager))
      .rejects.toThrow(SessionError);
  });

  it('should handle health check timeout', async () => {
    setupSession(sessionManager);
    vi.mocked(waitForHealthy).mockResolvedValue(false);

    const result = await handleSetup({ projectPath: '/test/project' }, sessionManager);

    expect(result.services[0]!.status).toBe('unhealthy');
  });

  it('should handle port conflict', async () => {
    setupSession(sessionManager);
    vi.mocked(isPortInUse).mockResolvedValue(true);

    await expect(handleSetup({ projectPath: '/test/project' }, sessionManager))
      .rejects.toThrow(SessionError);

    try {
      vi.mocked(isPortInUse).mockResolvedValue(true);
      setupSession(sessionManager, '/test/project2');
      await handleSetup({ projectPath: '/test/project2' }, sessionManager);
    } catch (err) {
      expect((err as SessionError).code).toBe('PORT_CONFLICT');
    }
  });

  it('should use container port in healthcheck command (#2)', async () => {
    const manager = new SessionManager();
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test-hc-port' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: {
          name: 'test-app',
          ports: ['18080:8080'],
          healthcheck: { path: '/health', interval: '10s', timeout: '5s', retries: 10, startPeriod: '30s' },
        },
      },
      network: { name: 'test-net' },
      resilience: {
        preflight: { enabled: false },
        circuitBreaker: { enabled: false },
      },
    } as E2EConfig;
    manager.create('/test/hc-port', config, '/test/hc-port/e2e.yaml');
    manager.transition('/test/hc-port', 'built');

    await handleSetup({ projectPath: '/test/hc-port' }, manager);

    expect(startContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        healthcheck: expect.objectContaining({
          cmd: expect.stringContaining(':8080/health'),
        }),
      }),
    );
  });

  it('should use explicit healthcheck port when specified (#2)', async () => {
    const manager = new SessionManager();
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test-hc-explicit' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: {
          name: 'test-app',
          ports: ['18080:8080'],
          healthcheck: { path: '/health', port: 3000, interval: '10s', timeout: '5s', retries: 10, startPeriod: '30s' },
        },
      },
      network: { name: 'test-net' },
      resilience: {
        preflight: { enabled: false },
        circuitBreaker: { enabled: false },
      },
    } as E2EConfig;
    manager.create('/test/hc-explicit', config, '/test/hc-explicit/e2e.yaml');
    manager.transition('/test/hc-explicit', 'built');

    await handleSetup({ projectPath: '/test/hc-explicit' }, manager);

    expect(startContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        healthcheck: expect.objectContaining({
          cmd: expect.stringContaining(':3000/health'),
        }),
      }),
    );
  });

  it('should namespace container names and add network-alias + labels (issue #9)', async () => {
    // Previous tests may have left isPortInUse mocked as "in use".
    vi.mocked(isPortInUse).mockResolvedValue(false);
    setupSession(sessionManager);

    await handleSetup({ projectPath: '/test/project' }, sessionManager);

    expect(startContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test-test-app',
        networkAlias: ['test-app'],
        labels: expect.objectContaining({
          'argusai.managed': 'true',
          'argusai.project': 'test',
          'argusai.run-id': expect.any(String),
        }),
      }),
    );
    // Network is labelled so OrphanCleaner can find it.
    expect(ensureNetwork).toHaveBeenCalledWith(
      'test-net',
      expect.objectContaining({ 'argusai.managed': 'true', 'argusai.project': 'test' }),
    );
    // Health check targets the actual (namespaced) container name.
    expect(waitForHealthy).toHaveBeenCalledWith('test-test-app', expect.any(Number));
    // Session records the YAML name → actual name mapping.
    const session = sessionManager.getOrThrow('/test/project');
    expect(session.containerNames.get('test-app')).toBe('test-test-app');
  });

  it('should use isolation.namespace as the container name prefix (issue #9)', async () => {
    const manager = new SessionManager();
    const config: E2EConfig = {
      version: '1',
      project: { name: 'recursive-agent' },
      isolation: { namespace: 'wt-abc123' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'recursive:e2e' },
        container: { name: 'recursive-e2e', ports: ['8080:8080'] },
      },
      resilience: { preflight: { enabled: false }, circuitBreaker: { enabled: false } },
    } as E2EConfig;
    manager.create('/test/ns', config, '/test/ns/e2e.yaml');
    manager.transition('/test/ns', 'built');

    await handleSetup({ projectPath: '/test/ns' }, manager);

    expect(startContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'wt-abc123-recursive-e2e',
        networkAlias: ['recursive-e2e'],
      }),
    );
  });

  it('should read back Docker random host ports (ports: ["0:8080"]) and record them (issue #9)', async () => {
    const manager = new SessionManager();
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test-rand-port' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: { name: 'app', ports: ['0:8080'] },
      },
      network: { name: 'test-net' },
      resilience: { preflight: { enabled: false }, circuitBreaker: { enabled: false } },
    } as E2EConfig;
    manager.create('/test/rand', config, '/test/rand/e2e.yaml');
    manager.transition('/test/rand', 'built');

    const result = await handleSetup({ projectPath: '/test/rand' }, manager);

    expect(getHostPort).toHaveBeenCalledWith('test-rand-port-app', 8080);
    expect(result.services[0]!.ports).toEqual([{ host: 49153, container: 8080 }]);
    const session = manager.getOrThrow('/test/rand');
    expect(session.containerHostPorts.get('app')).toEqual([{ host: 49153, container: 8080 }]);
  });

  it('should namespace image-based mock containers with alias + labels (issue #9)', async () => {
    const manager = new SessionManager();
    const config: E2EConfig = {
      version: '1',
      project: { name: 'mock-proj' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'svc:latest' },
        container: { name: 'svc', ports: ['8080:8080'] },
      },
      mocks: { aimock: { image: 'aimock:latest', port: 4010 } },
      network: { name: 'test-net' },
      resilience: { preflight: { enabled: false }, circuitBreaker: { enabled: false } },
    } as E2EConfig;
    manager.create('/test/mockproj', config, '/test/mockproj/e2e.yaml');
    manager.transition('/test/mockproj', 'built');

    const result = await handleSetup({ projectPath: '/test/mockproj' }, manager);

    const runCalls = mockExecFile.mock.calls.filter(c => (c[1] as string[])?.includes('run'));
    const runArgs = runCalls[0]![1] as string[];
    const nameIdx = runArgs.indexOf('--name');
    expect(runArgs[nameIdx + 1]).toBe('mock-proj-aimock');
    const aliasIdx = runArgs.indexOf('--network-alias');
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(runArgs[aliasIdx + 1]).toBe('aimock');
    expect(runArgs).toContain('argusai.managed=true');
    expect(result.mocks[0]!.status).toBe('running');
    expect(manager.getOrThrow('/test/mockproj').containerNames.get('aimock')).toBe('mock-proj-aimock');
  });
});
