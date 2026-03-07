/**
 * Unit tests for argus_build tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleBuild } from '../../../src/tools/build.js';
import type { E2EConfig } from 'argusai-core';

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    buildImage: vi.fn(),
    dockerExec: vi.fn(),
  };
});

const { buildImage, dockerExec } = await import('argusai-core');

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

describe('handleBuild', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  it('should build successfully', async () => {
    setupSession(sessionManager);

    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_start', image: 'test:latest', timestamp: Date.now() };
      yield { type: 'build_log', line: 'Step 1/3', stream: 'stdout', timestamp: Date.now() };
      yield { type: 'build_end', success: true, duration: 1000, timestamp: Date.now() };
    } as any);

    const result = await handleBuild({ projectPath: '/test/project' }, sessionManager);

    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.status).toBe('success');
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    expect(sessionManager.getOrThrow('/test/project').state).toBe('built');
  });

  it('should handle failed build', async () => {
    setupSession(sessionManager);

    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_start', image: 'test:latest', timestamp: Date.now() };
      yield { type: 'build_end', success: false, duration: 500, error: 'Build failed', timestamp: Date.now() };
    } as any);

    const result = await handleBuild({ projectPath: '/test/project' }, sessionManager);

    expect(result.services[0]!.status).toBe('failed');
    expect(result.services[0]!.error).toBe('Build failed');
    expect(sessionManager.getOrThrow('/test/project').state).toBe('initialized');
  });

  it('should throw SESSION_NOT_FOUND without session', async () => {
    await expect(handleBuild({ projectPath: '/missing' }, sessionManager))
      .rejects.toThrow(SessionError);

    try {
      await handleBuild({ projectPath: '/missing' }, sessionManager);
    } catch (err) {
      expect((err as SessionError).code).toBe('SESSION_NOT_FOUND');
    }
  });

  it('should pass noCache option', async () => {
    setupSession(sessionManager);

    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_end', success: true, duration: 100, timestamp: Date.now() };
    } as any);

    const result = await handleBuild(
      { projectPath: '/test/project', noCache: true },
      sessionManager,
    );

    expect(result.services[0]!.status).toBe('success');
    expect(buildImage).toHaveBeenCalledWith(expect.objectContaining({ noCache: true }));
  });

  it('should include build logs in error message on failure (#5)', async () => {
    setupSession(sessionManager);

    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_start', image: 'test:latest', timestamp: Date.now() };
      yield { type: 'build_log', line: 'Step 1/3: FROM node:18', stream: 'stdout', timestamp: Date.now() };
      yield { type: 'build_log', line: 'Step 2/3: COPY . .', stream: 'stdout', timestamp: Date.now() };
      yield { type: 'build_log', line: 'COPY failed: file not found', stream: 'stderr', timestamp: Date.now() };
      yield { type: 'build_end', success: false, duration: 500, error: 'Build exited with code 1', timestamp: Date.now() };
    } as any);

    const result = await handleBuild({ projectPath: '/test/project' }, sessionManager);

    expect(result.services[0]!.status).toBe('failed');
    expect(result.services[0]!.error).toContain('Build exited with code 1');
    expect(result.services[0]!.error).toContain('COPY failed: file not found');
    expect(result.services[0]!.error).toContain('Last 3 lines');
  });

  it('should skip build with useExisting when image exists (#3)', async () => {
    setupSession(sessionManager);
    vi.mocked(dockerExec).mockResolvedValue('sha256:abc123');

    const result = await handleBuild(
      { projectPath: '/test/project', useExisting: true },
      sessionManager,
    );

    expect(result.services[0]!.status).toBe('success');
    expect(buildImage).not.toHaveBeenCalled();
    expect(dockerExec).toHaveBeenCalledWith(['image', 'inspect', 'test:latest']);
  });

  it('should fall back to build with useExisting when image does not exist (#3)', async () => {
    setupSession(sessionManager);
    vi.mocked(dockerExec).mockRejectedValue(new Error('No such image'));

    vi.mocked(buildImage).mockImplementation(async function* () {
      yield { type: 'build_end', success: true, duration: 100, timestamp: Date.now() };
    } as any);

    const result = await handleBuild(
      { projectPath: '/test/project', useExisting: true },
      sessionManager,
    );

    expect(result.services[0]!.status).toBe('success');
    expect(buildImage).toHaveBeenCalled();
  });
});
