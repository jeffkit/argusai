/**
 * Unit tests for argus_run and argus_run_suite tool handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import net from 'node:net';
import { SessionManager, SessionError } from '../../../src/session.js';
import { handleRun, handleRunSuite, ensureEnvironmentReady } from '../../../src/tools/run.js';
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
    // run.ts uses executeSuitesWithParallel (which calls executeYAMLSuite internally
    // in the real module). Mock it to delegate to the mocked executeYAMLSuite export.
    executeSuitesWithParallel: vi.fn(async function* (
      configs: Array<{ suite: { name: string }; options?: unknown }>,
    ) {
      const { executeYAMLSuite: mocked } = await import('argusai-core');
      for (const c of configs) {
        yield* (mocked as (s: unknown, o?: unknown) => AsyncGenerator<TestEvent>)(c.suite, c.options);
      }
    }),
    createDefaultRegistry: vi.fn(),
    isContainerRunning: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../../src/tools/setup.js', () => ({
  handleSetup: vi.fn().mockResolvedValue({
    network: { name: 'test-net', created: false },
    services: [],
    mocks: [],
    totalDuration: 0,
  }),
}));

const { executeYAMLSuite, isContainerRunning } = await import('argusai-core');
const { handleSetup } = await import('../../../src/tools/setup.js');

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

function* mockEvents(suiteName = 'API Tests', suiteId?: string): Generator<TestEvent> {
  const sid = suiteId ? { suiteId } : {};
  yield { type: 'suite_start', suite: suiteName, ...sid, timestamp: Date.now() };
  yield { type: 'case_start', suite: suiteName, ...sid, name: 'test 1', timestamp: Date.now() };
  yield { type: 'case_pass', suite: suiteName, ...sid, name: 'test 1', duration: 100, timestamp: Date.now() };
  yield { type: 'case_start', suite: suiteName, ...sid, name: 'test 2', timestamp: Date.now() };
  yield { type: 'case_fail', suite: suiteName, ...sid, name: 'test 2', error: 'Expected 200 got 500', duration: 200, timestamp: Date.now() };
  yield { type: 'suite_end', suite: suiteName, ...sid, passed: 1, failed: 1, skipped: 0, duration: 300, timestamp: Date.now() };
}

describe('handleRun', () => {
  let sessionManager: SessionManager;
  let formatter: ResultFormatter;

  beforeEach(() => {
    sessionManager = new SessionManager();
    formatter = new ResultFormatter();
    vi.clearAllMocks();
    vi.mocked(isContainerRunning).mockResolvedValue(true);
  });

  it('should run all suites and return results', async () => {
    createRunningSession(sessionManager);

    vi.mocked(executeYAMLSuite).mockImplementation(async function* (_suite: unknown, options?: { suiteId?: string }) {
      yield* mockEvents('API Tests', options?.suiteId);
    } as any);

    const result = await handleRun({ projectPath: '/test/project' }, sessionManager, formatter);

    expect(result.status).toBe('failed');
    expect(result.totals.passed).toBeGreaterThanOrEqual(1);
    expect(result.totals.failed).toBeGreaterThanOrEqual(1);
    expect(result.suites.length).toBeGreaterThanOrEqual(1);
  });

  it('should attribute cases by suite id when e2e name ≠ yaml name (issue #8)', async () => {
    const config: E2EConfig = {
      version: '1',
      project: { name: 'test' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: { name: 'test-app', ports: ['3000:3000'] },
      },
      tests: {
        suites: [
          // e2e.yaml display name "A" — deliberately different from yaml file name "B"
          { id: 'my-suite', name: 'A', file: 'tests/my-suite.yaml', runner: 'yaml' },
        ],
      },
      network: { name: 'test-net' },
    };
    sessionManager.create('/test/mismatch', config, '/test/mismatch/e2e.yaml');
    sessionManager.transition('/test/mismatch', 'built');
    sessionManager.transition('/test/mismatch', 'running');

    const { loadYAMLTests } = await import('argusai-core');
    vi.mocked(loadYAMLTests).mockResolvedValue({
      name: 'B', // yaml file name differs from e2e entry name "A"
      cases: [{ name: 'must fail' } as any],
    });

    vi.mocked(executeYAMLSuite).mockImplementation(async function* (suite: { name: string }, options?: { suiteId?: string }) {
      // Engine emits events with yaml file name, but stamps suiteId from options
      yield* mockEvents(suite.name, options?.suiteId);
    } as any);

    const result = await handleRun(
      { projectPath: '/test/mismatch', filter: 'my-suite' },
      sessionManager,
      formatter,
    );

    // Must NOT be a silent false-green with total:0
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(result.totals.total).toBeGreaterThan(0);
    expect(result.totals.failed).toBeGreaterThanOrEqual(1);
    expect(result.suites[0]!.id).toBe('my-suite');
    expect(result.suites[0]!.cases.length).toBeGreaterThan(0);
  });

  it('should auto-setup when environment is not running (issue #5)', async () => {
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
        ],
      },
      network: { name: 'test-net' },
    };
    sessionManager.create('/test/project', config, '/path');
    // initialized, not running — containers missing
    vi.mocked(isContainerRunning).mockResolvedValue(false);
    vi.mocked(executeYAMLSuite).mockImplementation(async function* () {
      yield { type: 'suite_start', suite: 'API Tests', timestamp: Date.now() };
      yield { type: 'case_pass', suite: 'API Tests', name: 'test 1', duration: 50, timestamp: Date.now() };
      yield { type: 'suite_end', suite: 'API Tests', passed: 1, failed: 0, skipped: 0, duration: 50, timestamp: Date.now() };
    } as any);
    // After setup, session must be running for subsequent checks — simulate transition
    vi.mocked(handleSetup).mockImplementation(async (params: { projectPath: string }) => {
      sessionManager.transition(params.projectPath, 'built');
      sessionManager.transition(params.projectPath, 'running');
      vi.mocked(isContainerRunning).mockResolvedValue(true);
      return {
        network: { name: 'test-net', created: true },
        services: [{ name: 'test', containerId: 'c1', status: 'healthy' as const, ports: [{ host: 3000, container: 3000 }] }],
        mocks: [],
        totalDuration: 10,
      };
    });

    const result = await handleRun({ projectPath: '/test/project' }, sessionManager, formatter);

    expect(handleSetup).toHaveBeenCalled();
    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.warnings?.some(w => w.includes('auto-started'))).toBe(true);
  });

  it('should return exitCode 1 when cases fail (issue #6)', async () => {
    createRunningSession(sessionManager);
    vi.mocked(isContainerRunning).mockResolvedValue(true);
    vi.mocked(executeYAMLSuite).mockImplementation(async function* (_suite: unknown, options?: { suiteId?: string }) {
      yield* mockEvents('API Tests', options?.suiteId);
    } as any);

    const result = await handleRun({ projectPath: '/test/project' }, sessionManager, formatter);

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(1);
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
    vi.mocked(isContainerRunning).mockResolvedValue(true);
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

describe('ensureEnvironmentReady readiness wait (issue #11)', () => {
  let sessionManager: SessionManager;
  let formatter: ResultFormatter;

  beforeEach(() => {
    sessionManager = new SessionManager();
    formatter = new ResultFormatter();
    vi.clearAllMocks();
    vi.mocked(isContainerRunning).mockResolvedValue(true);
  });

  function readinessConfig(): E2EConfig {
    return {
      version: '1',
      project: { name: 'readiness' },
      service: {
        build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
        container: { name: 'ready-app', ports: ['3000:3000'] },
      },
      tests: {
        suites: [{ id: 'api', name: 'API Tests', file: 'tests/api.yaml', runner: 'yaml' }],
      },
      network: { name: 'test-net' },
    };
  }

  it('should wait for a healthcheck-less service to accept TCP connections before running cases', async () => {
    sessionManager.create('/test/readiness', readinessConfig(), '/test/readiness/e2e.yaml');
    vi.mocked(isContainerRunning).mockResolvedValue(false);

    // Reserve an ephemeral port, release it, then re-bind it after a "boot"
    // delay once handleSetup has already returned.
    const server = net.createServer(sock => { sock.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>(resolve => server.close(() => resolve()));

    let gotConnection = false;
    const listening = net.createServer(sock => { gotConnection = true; sock.end(); });
    setTimeout(() => listening.listen(port, '127.0.0.1'), 600);

    vi.mocked(handleSetup).mockImplementation(async (params: { projectPath: string }) => {
      sessionManager.transition(params.projectPath, 'built');
      sessionManager.transition(params.projectPath, 'running');
      return {
        network: { name: 'test-net', created: true },
        services: [{
          name: 'app',
          containerId: 'c1',
          status: 'running' as const, // no healthcheck — setup does not wait for it
          ports: [{ host: port, container: 3000 }],
        }],
        mocks: [],
        totalDuration: 10,
      };
    });

    vi.mocked(executeYAMLSuite).mockImplementation(async function* () {
      yield { type: 'suite_start', suite: 'API Tests', timestamp: Date.now() };
      yield { type: 'case_pass', suite: 'API Tests', name: 'test 1', duration: 50, timestamp: Date.now() };
      yield { type: 'suite_end', suite: 'API Tests', passed: 1, failed: 0, skipped: 0, duration: 50, timestamp: Date.now() };
    } as any);

    try {
      const result = await handleRun({ projectPath: '/test/readiness' }, sessionManager, formatter);

      expect(result.status).toBe('passed');
      // The server-side 'connection' event is a macrotask — the client-side
      // dial resolves as a microtask first. Give the loop one pass.
      await new Promise(resolve => setTimeout(resolve, 50));
      // The readiness wait must have dialed the port before any case ran
      expect(gotConnection).toBe(true);
    } finally {
      listening.close();
    }
  });

  it('should warn when an auto-started service port never opens', async () => {
    sessionManager.create('/test/never-ready', readinessConfig(), '/test/never-ready/e2e.yaml');
    vi.mocked(isContainerRunning).mockResolvedValue(false);

    vi.mocked(handleSetup).mockImplementation(async (params: { projectPath: string }) => {
      sessionManager.transition(params.projectPath, 'built');
      sessionManager.transition(params.projectPath, 'running');
      return {
        network: { name: 'test-net', created: true },
        services: [{
          name: 'stuck',
          containerId: 'c1',
          status: 'running' as const,
          // port 1 on localhost refuses connections immediately
          ports: [{ host: 1, container: 3000 }],
        }],
        mocks: [],
        totalDuration: 10,
      };
    });

    const session = sessionManager.getOrThrow('/test/never-ready');
    const warnings = await ensureEnvironmentReady(session, sessionManager, { readyTimeoutMs: 400 });

    expect(warnings.some(w => w.includes('auto-started'))).toBe(true);
    expect(warnings.some(w => w.includes('"stuck"') && w.includes('did not accept connections'))).toBe(true);
  });

  it('should surface failed services from setup as warnings', async () => {
    sessionManager.create('/test/setup-fail', readinessConfig(), '/test/setup-fail/e2e.yaml');
    vi.mocked(isContainerRunning).mockResolvedValue(false);

    vi.mocked(handleSetup).mockImplementation(async (params: { projectPath: string }) => {
      sessionManager.transition(params.projectPath, 'built');
      sessionManager.transition(params.projectPath, 'running');
      return {
        network: { name: 'test-net', created: true },
        services: [{
          name: 'broken',
          containerId: '',
          status: 'failed' as const,
          ports: [],
          error: 'image not found',
        }],
        mocks: [],
        totalDuration: 10,
      };
    });

    const session = sessionManager.getOrThrow('/test/setup-fail');
    const warnings = await ensureEnvironmentReady(session, sessionManager, { readyTimeoutMs: 200 });

    expect(warnings.some(w => w.includes('Service "broken" is failed after auto-start: image not found'))).toBe(true);
  });
});
