/**
 * Unit tests for argus_init tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleInit } from '../../../src/tools/init.js';

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    loadConfig: vi.fn(),
  };
});

const { loadConfig } = await import('argusai-core');

function mockConfig() {
  return {
    version: '1',
    project: { name: 'test-project', description: 'A test' },
    service: {
      build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
      container: { name: 'test-container', ports: ['3000:3000'], healthcheck: { path: '/health' } },
    },
    mocks: {
      'cos-mock': { port: 9100, routes: [{ method: 'GET', path: '/data', response: { status: 200, body: {} } }] },
    },
    tests: {
      suites: [
        { id: 'api', name: 'API Tests', file: 'tests/api.yaml', runner: 'yaml' },
        { id: 'e2e', name: 'E2E Tests', file: 'tests/e2e.yaml' },
      ],
    },
    network: { name: 'test-net' },
  };
}

describe('handleInit', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should initialize a session with valid config', async () => {
    vi.mocked(loadConfig).mockResolvedValue(mockConfig() as any);

    const result = await handleInit(
      { projectPath: '/test/project' },
      sessionManager,
    );

    expect(result.projectName).toBe('test-project');
    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.name).toBe('test-container');
    expect(result.services[0]!.hasHealthcheck).toBe(true);
    expect(result.mocks).toHaveLength(1);
    expect(result.mocks[0]!.name).toBe('cos-mock');
    expect(result.mocks[0]!.routeCount).toBe(1);
    expect(result.suites).toHaveLength(2);
    expect(result.schemaVersion).toBe('1');
    expect(sessionManager.has('/test/project')).toBe(true);
  });

  it('should use custom config file name', async () => {
    vi.mocked(loadConfig).mockResolvedValue(mockConfig() as any);

    await handleInit(
      { projectPath: '/test/project', configFile: 'custom.yaml' },
      sessionManager,
    );

    expect(loadConfig).toHaveBeenCalledWith(expect.stringContaining('custom.yaml'));
  });

  it('should throw SESSION_EXISTS for duplicate session', async () => {
    vi.mocked(loadConfig).mockResolvedValue(mockConfig() as any);

    await handleInit({ projectPath: '/test/project' }, sessionManager);

    await expect(handleInit({ projectPath: '/test/project' }, sessionManager))
      .rejects.toThrow(SessionError);
  });

  it('should re-initialize a lazily-created session instead of throwing', async () => {
    vi.mocked(loadConfig).mockResolvedValue(mockConfig() as any);

    // A read-only tool lazily created the session first.
    const lazy = await sessionManager.ensure('/test/project');
    expect(lazy.lazy).toBe(true);

    // An explicit init should succeed (replacing the lazy session), not throw.
    const result = await handleInit({ projectPath: '/test/project' }, sessionManager);
    expect(result.projectName).toBe('test-project');
    expect(sessionManager.getOrThrow('/test/project').lazy).toBeFalsy();
  });

  it('should throw CONFIG_NOT_FOUND when config is missing', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('Configuration file not found: /test/project/e2e.yaml'));

    await expect(handleInit({ projectPath: '/test/project' }, sessionManager))
      .rejects.toThrow(SessionError);

    try {
      await handleInit({ projectPath: '/test/other' }, sessionManager);
    } catch (err) {
      expect((err as SessionError).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('should throw CONFIG_INVALID for invalid config', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('Configuration validation failed:\n  - project.name: Required'));

    try {
      await handleInit({ projectPath: '/test/project' }, sessionManager);
    } catch (err) {
      expect((err as SessionError).code).toBe('CONFIG_INVALID');
    }
  });

  it('should handle config with no mocks or tests', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      version: '1',
      project: { name: 'minimal' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'app:latest' },
        container: { name: 'app', ports: ['8080:8080'] },
      },
    } as any);

    const result = await handleInit({ projectPath: '/test/minimal' }, sessionManager);

    expect(result.mocks).toEqual([]);
    expect(result.suites).toEqual([]);
    expect(result.services).toHaveLength(1);
  });
});
