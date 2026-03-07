/**
 * Unit tests for argus_clean tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleClean } from '../../../src/tools/clean.js';
import type { E2EConfig } from 'argusai-core';

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeNetwork: vi.fn().mockResolvedValue(undefined),
    findContainersByLabel: vi.fn().mockResolvedValue([]),
  };
});

const { stopContainer, findContainersByLabel } = await import('argusai-core');

function setupSession(manager: SessionManager, projectPath = '/test/project'): void {
  const config: E2EConfig = {
    version: '1',
    project: { name: 'test' },
    service: {
      build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
      container: { name: 'test-container', ports: ['3000:3000'] },
    },
    network: { name: 'test-net' },
    resilience: {
      preflight: { enabled: false },
      circuitBreaker: { enabled: false },
    },
  } as E2EConfig;
  manager.create(projectPath, config, `${projectPath}/e2e.yaml`);
}

describe('handleClean', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should clean containers from config and session', async () => {
    setupSession(sessionManager);

    const result = await handleClean({ projectPath: '/test/project' }, sessionManager);

    expect(result.containers.length).toBeGreaterThanOrEqual(1);
    expect(result.sessionRemoved).toBe(true);
    expect(stopContainer).toHaveBeenCalled();
  });

  it('should return gracefully when no session exists', async () => {
    const result = await handleClean({ projectPath: '/nonexistent' }, sessionManager);

    expect(result.containers).toHaveLength(0);
    expect(result.sessionRemoved).toBe(false);
  });

  it('should also clean label-discovered residual containers (#8)', async () => {
    setupSession(sessionManager);
    vi.mocked(findContainersByLabel).mockResolvedValue(['orphan-container-1', 'orphan-container-2']);

    const result = await handleClean({ projectPath: '/test/project' }, sessionManager);

    expect(findContainersByLabel).toHaveBeenCalledWith('argusai.project=test');
    const containerNames = result.containers.map(c => c.name);
    expect(containerNames).toContain('orphan-container-1');
    expect(containerNames).toContain('orphan-container-2');
  });

  it('should continue cleanup if label lookup fails (#8)', async () => {
    setupSession(sessionManager);
    vi.mocked(findContainersByLabel).mockRejectedValue(new Error('Docker unreachable'));

    const result = await handleClean({ projectPath: '/test/project' }, sessionManager);

    expect(result.sessionRemoved).toBe(true);
    expect(result.containers.length).toBeGreaterThanOrEqual(1);
  });
});
