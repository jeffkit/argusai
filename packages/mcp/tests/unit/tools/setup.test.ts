/**
 * Unit tests for argus_setup tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleSetup } from '../../../src/tools/setup.js';
import type { E2EConfig } from 'argusai-core';

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    ensureNetwork: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn().mockResolvedValue('abc123def456'),
    waitForHealthy: vi.fn().mockResolvedValue(true),
    isPortInUse: vi.fn().mockResolvedValue(false),
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

const { startContainer, waitForHealthy, isPortInUse } = await import('argusai-core');

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
});
