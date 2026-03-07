/**
 * Unit tests for argus_run and argus_run_suite tool handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleRun, handleRunSuite } from '../../../src/tools/run.js';
import { ResultFormatter } from '../../../src/formatters/result-formatter.js';
import type { E2EConfig } from 'argusai-core';
import type { TestEvent } from 'argusai-core';

vi.mock('argusai-core', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    loadYAMLTests: vi.fn().mockResolvedValue({
      name: 'API Tests',
      cases: [],
    }),
    executeYAMLSuite: vi.fn(),
    createDefaultRegistry: vi.fn(),
  };
});

const { executeYAMLSuite } = await import('argusai-core');

function createRunningSession(manager: SessionManager, projectPath = '/test/project'): void {
  const config: E2EConfig = {
    version: '1',
    project: { name: 'test' },
    service: {
      build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
      container: { name: 'test-app', ports: ['3000:3000'] },
    },
    tests: {
      suites: [
        { id: 'api', name: 'API Tests', file: 'tests/api.yaml', runner: 'yaml' },
        { id: 'e2e', name: 'E2E Tests', file: 'tests/e2e.yaml', runner: 'yaml' },
      ],
    },
    network: { name: 'test-net' },
  };
  manager.create(projectPath, config, `${projectPath}/e2e.yaml`);
  manager.transition(projectPath, 'built');
  manager.transition(projectPath, 'running');
}

function* mockEvents(): Generator<TestEvent> {
  yield { type: 'suite_start', suite: 'API Tests', timestamp: Date.now() };
  yield { type: 'case_start', suite: 'API Tests', name: 'test 1', timestamp: Date.now() };
  yield { type: 'case_pass', suite: 'API Tests', name: 'test 1', duration: 100, timestamp: Date.now() };
  yield { type: 'case_start', suite: 'API Tests', name: 'test 2', timestamp: Date.now() };
  yield { type: 'case_fail', suite: 'API Tests', name: 'test 2', error: 'Expected 200 got 500', duration: 200, timestamp: Date.now() };
  yield { type: 'suite_end', suite: 'API Tests', passed: 1, failed: 1, skipped: 0, duration: 300, timestamp: Date.now() };
}

describe('handleRun', () => {
  let sessionManager: SessionManager;
  let formatter: ResultFormatter;

  beforeEach(() => {
    sessionManager = new SessionManager();
    formatter = new ResultFormatter();
    vi.clearAllMocks();
  });

  it('should run all suites and return results', async () => {
    createRunningSession(sessionManager);

    vi.mocked(executeYAMLSuite).mockImplementation(async function* () {
      yield* mockEvents();
    } as any);

    const result = await handleRun({ projectPath: '/test/project' }, sessionManager, formatter);

    expect(result.status).toBe('failed');
    expect(result.totals.passed).toBeGreaterThanOrEqual(1);
    expect(result.totals.failed).toBeGreaterThanOrEqual(1);
    expect(result.suites.length).toBeGreaterThanOrEqual(1);
  });

  it('should throw NOT_RUNNING if environment is not set up', async () => {
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: { name: 'test-app', ports: ['3000:3000'] },
      },
      network: { name: 'test-net' },
    };
    sessionManager.create('/test/project', config, '/path');

    await expect(handleRun({ projectPath: '/test/project' }, sessionManager, formatter))
      .rejects.toThrow(SessionError);
  });

  it('should allow test-only mode: run without services in initialized state (#4)', async () => {
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test-only' },
      tests: {
        suites: [
          { id: 'api', name: 'API Tests', file: 'tests/api.yaml', runner: 'yaml' },
        ],
      },
      network: { name: 'test-net' },
    } as E2EConfig;
    sessionManager.create('/test/test-only', config, '/test/test-only/e2e.yaml');

    vi.mocked(executeYAMLSuite).mockImplementation(async function* () {
      yield { type: 'suite_start', suite: 'API Tests', timestamp: Date.now() };
      yield { type: 'case_pass', suite: 'API Tests', name: 'test 1', duration: 50, timestamp: Date.now() };
      yield { type: 'suite_end', suite: 'API Tests', passed: 1, failed: 0, skipped: 0, duration: 50, timestamp: Date.now() };
    } as any);

    const result = await handleRun({ projectPath: '/test/test-only' }, sessionManager, formatter);

    expect(result.status).toBe('passed');
    expect(result.suites).toHaveLength(1);
  });

  it('should filter suites by ID', async () => {
    createRunningSession(sessionManager);

    vi.mocked(executeYAMLSuite).mockImplementation(async function* () {
      yield { type: 'suite_start', suite: 'API Tests', timestamp: Date.now() };
      yield { type: 'case_pass', suite: 'API Tests', name: 'test 1', duration: 50, timestamp: Date.now() };
      yield { type: 'suite_end', suite: 'API Tests', passed: 1, failed: 0, skipped: 0, duration: 50, timestamp: Date.now() };
    } as any);

    const result = await handleRun(
      { projectPath: '/test/project', filter: 'api' },
      sessionManager,
      formatter,
    );

    expect(result.suites).toHaveLength(1);
    expect(result.suites[0]!.id).toBe('api');
    expect(result.status).toBe('passed');
  });

  it('should throw SUITE_NOT_FOUND for invalid filter', async () => {
    createRunningSession(sessionManager);

    await expect(handleRun(
      { projectPath: '/test/project', filter: 'nonexistent' },
      sessionManager,
      formatter,
    )).rejects.toThrow(SessionError);
  });
});

describe('handleRunSuite', () => {
  let sessionManager: SessionManager;
  let formatter: ResultFormatter;

  beforeEach(() => {
    sessionManager = new SessionManager();
    formatter = new ResultFormatter();
    vi.clearAllMocks();
  });

  it('should run a single suite', async () => {
    createRunningSession(sessionManager);

    vi.mocked(executeYAMLSuite).mockImplementation(async function* () {
      yield { type: 'suite_start', suite: 'API Tests', timestamp: Date.now() };
      yield { type: 'case_pass', suite: 'API Tests', name: 'test 1', duration: 50, timestamp: Date.now() };
      yield { type: 'suite_end', suite: 'API Tests', passed: 1, failed: 0, skipped: 0, duration: 50, timestamp: Date.now() };
    } as any);

    const result = await handleRunSuite(
      { projectPath: '/test/project', suiteId: 'api' },
      sessionManager,
      formatter,
    );

    expect(result.suites).toHaveLength(1);
    expect(result.status).toBe('passed');
  });

  it('should throw SUITE_NOT_FOUND for invalid suite ID', async () => {
    createRunningSession(sessionManager);

    await expect(handleRunSuite(
      { projectPath: '/test/project', suiteId: 'unknown' },
      sessionManager,
      formatter,
    )).rejects.toThrow(SessionError);
  });
});
