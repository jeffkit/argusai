/**
 * Integration tests for new CLI commands.
 *
 * Uses in-process testing: creates Commander programs, mocks process.exit,
 * and captures console output. No subprocess spawning.
 *
 * Tests cover:
 * - history, flaky, trends, compare, diagnose, report-fix, patterns
 * - Error handling when stores are disabled
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  type TestRunRecord,
  type TestCaseRunRecord,
} from 'argusai-core';
import { MemoryHistoryStore } from 'argusai-core';

let tmpDir: string;
let store: MemoryHistoryStore;

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeRun(overrides: Partial<TestRunRecord> = {}): TestRunRecord {
  return {
    id: 'run-001',
    project: 'test-project',
    timestamp: now - 2 * DAY,
    gitCommit: 'abc123',
    gitBranch: 'main',
    configHash: 'hash1',
    trigger: 'cli',
    duration: 5000,
    passed: 3,
    failed: 0,
    skipped: 0,
    flaky: 0,
    status: 'passed',
    ...overrides,
  };
}

function makeCase(overrides: Partial<TestCaseRunRecord> = {}): TestCaseRunRecord {
  return {
    id: 'case-001',
    runId: 'run-001',
    suiteId: 'basic',
    caseName: 'GET /health',
    status: 'passed',
    duration: 100,
    attempts: 1,
    responseMs: 50,
    assertions: 2,
    error: null,
    snapshot: null,
    ...overrides,
  };
}

function captureOutput(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  return {
    logs,
    errors,
    restore() {
      console.log = origLog;
      console.error = origError;
    },
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argusai-inproc-'));

  const e2eYaml = `
version: "1"
project:
  name: test-project
service:
  build:
    image: test:latest
    dockerfile: ./Dockerfile
    context: .
  container:
    name: test-e2e
    ports:
      - "8080:8080"
history:
  enabled: true
  storage: memory
  retention:
    maxAge: "90d"
    maxRuns: 1000
  flakyWindow: 10
`;
  fs.writeFileSync(path.join(tmpDir, 'e2e.yaml'), e2eYaml, 'utf-8');

  store = new MemoryHistoryStore();

  store.saveRun(
    makeRun({ id: 'run-001', timestamp: now - 2 * DAY, passed: 3, failed: 0, status: 'passed' }),
    [
      makeCase({ id: 'c-001-1', runId: 'run-001', caseName: 'GET /health', status: 'passed' }),
      makeCase({ id: 'c-001-2', runId: 'run-001', caseName: 'GET /api/info', status: 'passed' }),
      makeCase({ id: 'c-001-3', runId: 'run-001', caseName: 'POST /api/data', status: 'passed' }),
    ],
  );

  store.saveRun(
    makeRun({ id: 'run-002', timestamp: now - DAY, passed: 2, failed: 1, status: 'failed' }),
    [
      makeCase({ id: 'c-002-1', runId: 'run-002', caseName: 'GET /health', status: 'passed' }),
      makeCase({ id: 'c-002-2', runId: 'run-002', caseName: 'GET /api/info', status: 'failed', error: 'Expected 200 but got 500' }),
      makeCase({ id: 'c-002-3', runId: 'run-002', caseName: 'POST /api/data', status: 'passed' }),
    ],
  );

  store.saveRun(
    makeRun({ id: 'run-003', timestamp: now, passed: 2, failed: 1, flaky: 1, status: 'failed', gitBranch: 'feat/test' }),
    [
      makeCase({ id: 'c-003-1', runId: 'run-003', caseName: 'GET /health', status: 'passed' }),
      makeCase({ id: 'c-003-2', runId: 'run-003', caseName: 'GET /api/info', status: 'passed', attempts: 2 }),
      makeCase({ id: 'c-003-3', runId: 'run-003', caseName: 'POST /api/data', status: 'failed', error: 'ECONNREFUSED 127.0.0.1:8080' }),
    ],
  );
});

afterAll(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

vi.mock('../src/cli-context.js', () => {
  return {
    createCliContext: vi.fn(),
  };
});

import { createCliContext } from '../src/cli-context.js';
const mockedCreateCliContext = vi.mocked(createCliContext);

/**
 * Mock process.exit to throw instead of terminating.
 * Commander also calls process.exit on --help, so we need this.
 */
class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => {
    throw new ExitError(typeof code === 'number' ? code : 0);
  });

  mockedCreateCliContext.mockResolvedValue({
    config: {
      version: '1',
      project: { name: 'test-project' },
      history: { enabled: true, storage: 'memory', retention: { maxAge: '90d', maxRuns: 1000 }, flakyWindow: 10 },
    } as any,
    projectPath: tmpDir,
    historyStore: store,
    knowledgeStore: undefined,
    close: vi.fn(),
  });
});

afterEach(() => {
  exitSpy.mockRestore();
});

describe('history command (in-process)', () => {
  it('should list test runs', async () => {
    const { registerHistory } = await import('../src/commands/history.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerHistory(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['history'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('Test Run History');
    expect(allOutput).toContain('test-project');
  });

  it('should filter by status', async () => {
    const { registerHistory } = await import('../src/commands/history.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerHistory(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['history', '--status', 'failed'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('run-002');
  });

  it('should exit when history is disabled', async () => {
    mockedCreateCliContext.mockResolvedValue({
      config: { version: '1', project: { name: 'test' } } as any,
      projectPath: tmpDir,
      historyStore: undefined,
      knowledgeStore: undefined,
      close: vi.fn(),
    });

    const { registerHistory } = await import('../src/commands/history.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerHistory(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['history'], { from: 'user' });
    } catch (err) {
      if (err instanceof ExitError) {
        expect(err.code).toBe(1);
      } else {
        throw err;
      }
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('disabled');
  });
});

describe('flaky command (in-process)', () => {
  it('should detect flaky tests', async () => {
    const { registerFlaky } = await import('../src/commands/flaky.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerFlaky(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['flaky'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('Flaky Test Report');
    expect(allOutput).toContain('test-project');
  });
});

describe('trends command (in-process)', () => {
  it('should show pass-rate trends', async () => {
    const { registerTrends } = await import('../src/commands/trends.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerTrends(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['trends', '-m', 'pass-rate'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('Trends');
    expect(allOutput).toContain('Pass Rate');
  });

  it('should reject invalid metric', async () => {
    const { registerTrends } = await import('../src/commands/trends.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerTrends(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['trends', '-m', 'invalid'], { from: 'user' });
    } catch (err) {
      if (err instanceof ExitError) {
        expect(err.code).toBe(1);
      } else {
        throw err;
      }
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('Invalid metric');
  });
});

describe('compare command (in-process)', () => {
  it('should compare two runs', async () => {
    const { registerCompare } = await import('../src/commands/compare.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerCompare(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['compare', '--base', 'run-001', '--target', 'run-002'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('Run Comparison');
    expect(allOutput).toContain('run-001');
    expect(allOutput).toContain('run-002');
  });

  it('should show new failures', async () => {
    const { registerCompare } = await import('../src/commands/compare.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerCompare(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['compare', '--base', 'run-001', '--target', 'run-002'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('New Failures');
    expect(allOutput).toContain('GET /api/info');
  });

  it('should fail for non-existent run', async () => {
    const { registerCompare } = await import('../src/commands/compare.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerCompare(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['compare', '--base', 'run-999', '--target', 'run-001'], { from: 'user' });
    } catch (err) {
      if (err instanceof ExitError) {
        expect(err.code).toBe(1);
      } else {
        throw err;
      }
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('not found');
  });
});

describe('diagnose command (in-process)', () => {
  it('should diagnose a failed test case', async () => {
    mockedCreateCliContext.mockResolvedValue({
      config: {
        version: '1',
        project: { name: 'test-project' },
        history: { enabled: true, storage: 'memory', retention: { maxAge: '90d', maxRuns: 1000 }, flakyWindow: 10 },
      } as any,
      projectPath: tmpDir,
      historyStore: store,
      knowledgeStore: {
        match: vi.fn().mockReturnValue(null),
        findByCategory: vi.fn().mockReturnValue([]),
        getAllPatterns: vi.fn().mockReturnValue([]),
        close: vi.fn(),
      } as any,
      close: vi.fn(),
    });

    const { registerDiagnose } = await import('../src/commands/diagnose.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerDiagnose(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['diagnose', '--run', 'run-002', '--case', 'GET /api/info'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('Diagnosis');
    expect(allOutput).toContain('Category');
  });

  it('should fail for non-failed case', async () => {
    const { registerDiagnose } = await import('../src/commands/diagnose.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerDiagnose(program);

    mockedCreateCliContext.mockResolvedValue({
      config: { version: '1', project: { name: 'test-project' } } as any,
      projectPath: tmpDir,
      historyStore: store,
      knowledgeStore: { close: vi.fn() } as any,
      close: vi.fn(),
    });

    const output = captureOutput();
    try {
      await program.parseAsync(['diagnose', '--run', 'run-001', '--case', 'GET /health'], { from: 'user' });
    } catch (err) {
      if (err instanceof ExitError) {
        expect(err.code).toBe(1);
      } else {
        throw err;
      }
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('did not fail');
  });
});

describe('patterns command (in-process)', () => {
  it('should list failure patterns', async () => {
    mockedCreateCliContext.mockResolvedValue({
      config: { version: '1', project: { name: 'test-project' } } as any,
      projectPath: tmpDir,
      historyStore: store,
      knowledgeStore: {
        getAllPatterns: vi.fn().mockReturnValue([
          { id: 'p1', category: 'http_error', description: 'Server 500', confidence: 0.8, occurrences: 5, source: 'built-in', lastSeenAt: '2026-01-01', suggestedFix: 'Check server logs' },
        ]),
        findByCategory: vi.fn().mockReturnValue([]),
        close: vi.fn(),
      } as any,
      close: vi.fn(),
    });

    const { registerPatterns } = await import('../src/commands/patterns.js');
    const program = new Command();
    program.option('-c, --config <path>');
    registerPatterns(program);

    const output = captureOutput();
    try {
      await program.parseAsync(['patterns'], { from: 'user' });
    } finally {
      output.restore();
    }

    const allOutput = output.logs.join('\n');
    expect(allOutput).toContain('Failure Patterns');
    expect(allOutput).toContain('http_error');
    expect(allOutput).toContain('Server 500');
  });
});
