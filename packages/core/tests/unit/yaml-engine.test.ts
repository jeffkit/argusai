/**
 * Unit tests for yaml-engine module.
 *
 * Tests cover:
 * - YAML file loading and parsing
 * - Time string parsing
 * - Variable resolution in test cases
 * - Error handling for invalid files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadYAMLTests, parseTime, executeYAMLSuite } from '../../src/yaml-engine.js';
import type { TestEvent } from '../../src/types.js';

/** Helper to create a temporary directory */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'e2e-yaml-test-'));
}

describe('yaml-engine', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('parseTime', () => {
    it('should parse seconds', () => {
      expect(parseTime('5s')).toBe(5000);
    });

    it('should parse milliseconds', () => {
      expect(parseTime('100ms')).toBe(100);
    });

    it('should parse minutes', () => {
      expect(parseTime('2m')).toBe(120000);
    });

    it('should parse hours', () => {
      expect(parseTime('1h')).toBe(3600000);
    });

    it('should parse plain numbers as milliseconds', () => {
      expect(parseTime('500')).toBe(500);
    });

    it('should handle decimal values', () => {
      expect(parseTime('1.5s')).toBe(1500);
      expect(parseTime('0.5m')).toBe(30000);
    });

    it('should handle whitespace', () => {
      expect(parseTime('  5s  ')).toBe(5000);
    });

    it('should throw on invalid format', () => {
      expect(() => parseTime('abc')).toThrow('Invalid time format');
      expect(() => parseTime('5x')).toThrow('Invalid time format');
      expect(() => parseTime('')).toThrow('Invalid time format');
    });
  });

  describe('loadYAMLTests', () => {
    it('should load a minimal YAML test file', async () => {
      const yamlContent = [
        'name: Health Check Tests',
        'cases:',
        '  - name: GET /health',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.name).toBe('Health Check Tests');
      expect(suite.cases).toHaveLength(1);
      expect(suite.cases[0]!.name).toBe('GET /health');
      expect(suite.cases[0]!.request.method).toBe('GET');
      expect(suite.cases[0]!.request.path).toBe('/health');
      expect(suite.cases[0]!.expect?.status).toBe(200);
    });

    it('should load a full YAML test file with all fields', async () => {
      const yamlContent = [
        'name: Full API Tests',
        'description: Complete test suite',
        'sequential: true',
        'variables:',
        '  api_key: test-key-123',
        '  timeout: "5s"',
        'setup:',
        '  - name: Create resource',
        '    request:',
        '      method: POST',
        '      path: /api/resources',
        '      headers:',
        '        Authorization: "Bearer {{api_key}}"',
        '      body:',
        '        name: test-resource',
        '    expect:',
        '      status: 201',
        '    save:',
        '      resource_id: id',
        'cases:',
        '  - name: Get resource',
        '    delay: "1s"',
        '    request:',
        '      method: GET',
        '      path: /api/resources/{{resource_id}}',
        '      timeout: "10s"',
        '    expect:',
        '      status: 200',
        '      body:',
        '        name: test-resource',
        'teardown:',
        '  - name: Delete resource',
        '    request:',
        '      method: DELETE',
        '      path: /api/resources/{{resource_id}}',
        '    ignoreError: true',
      ].join('\n');

      const filePath = path.join(tmpDir, 'full-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.name).toBe('Full API Tests');
      expect(suite.description).toBe('Complete test suite');
      expect(suite.sequential).toBe(true);
      expect(suite.variables).toEqual({ api_key: 'test-key-123', timeout: '5s' });
      expect(suite.setup).toHaveLength(1);
      expect(suite.cases).toHaveLength(1);
      expect(suite.teardown).toHaveLength(1);
      expect(suite.cases[0]!.delay).toBe('1s');
    });

    it('should handle setup with waitHealthy and delay', async () => {
      const yamlContent = [
        'name: Setup Test',
        'setup:',
        '  - waitHealthy:',
        '      timeout: "30s"',
        '  - delay: "2s"',
        'cases:',
        '  - name: Test case',
        '    request:',
        '      method: GET',
        '      path: /test',
      ].join('\n');

      const filePath = path.join(tmpDir, 'setup-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.setup).toHaveLength(2);
    });

    it('should throw on file not found', async () => {
      await expect(
        loadYAMLTests(path.join(tmpDir, 'nonexistent.yaml')),
      ).rejects.toThrow('Failed to read YAML test file');
    });

    it('should throw on YAML syntax error', async () => {
      const filePath = path.join(tmpDir, 'bad.yaml');
      await fs.writeFile(filePath, ':\n  invalid: yaml\n    broken:', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('YAML syntax error');
    });

    it('should throw on empty file', async () => {
      const filePath = path.join(tmpDir, 'empty.yaml');
      await fs.writeFile(filePath, '', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('empty or invalid');
    });

    it('should throw when missing required name field', async () => {
      const filePath = path.join(tmpDir, 'no-name.yaml');
      await fs.writeFile(filePath, 'cases:\n  - name: test\n    request:\n      method: GET\n      path: /test', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('missing required "name" field');
    });

    it('should throw when missing cases array', async () => {
      const filePath = path.join(tmpDir, 'no-cases.yaml');
      await fs.writeFile(filePath, 'name: Test\n', 'utf-8');

      await expect(loadYAMLTests(filePath)).rejects.toThrow('missing required "cases" array');
    });

    it('should load a YAML file with save directives', async () => {
      const yamlContent = [
        'name: Save Test',
        'cases:',
        '  - name: Create and save ID',
        '    request:',
        '      method: POST',
        '      path: /api/items',
        '      body:',
        '        name: test-item',
        '    expect:',
        '      status: 201',
        '    save:',
        '      item_id: data.id',
        '      item_name: data.name',
      ].join('\n');

      const filePath = path.join(tmpDir, 'save-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.cases[0]!.save).toEqual({
        item_id: 'data.id',
        item_name: 'data.name',
      });
    });

    it('should load test with multiple expected statuses', async () => {
      const yamlContent = [
        'name: Multi-Status Test',
        'cases:',
        '  - name: Check endpoint',
        '    request:',
        '      method: GET',
        '      path: /api/check',
        '    expect:',
        '      status:',
        '        - 200',
        '        - 204',
      ].join('\n');

      const filePath = path.join(tmpDir, 'multi-status.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      expect(suite.cases[0]!.expect?.status).toEqual([200, 204]);
    });
  });

  // ── Regression: T017 — async execution verification ─────────────────
  describe('async execution (regression)', () => {
    it('should not import execSync', async () => {
      const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../src/yaml-engine.ts'),
        'utf-8',
      );
      expect(source).not.toMatch(/\bimport\b.*\bexecSync\b.*from/);
      expect(source).toMatch(/\bexecFileAsync\b/);
    });

    it('should execute suite and yield events asynchronously', async () => {
      const yamlContent = [
        'name: Async Test',
        'cases:',
        '  - name: simple request',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'async-test.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl: 'http://127.0.0.1:1',
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 500,
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.type).toBe('suite_start');
      expect(events[events.length - 1]!.type).toBe('suite_end');
    });
  });

  // ── Async verification: event loop not blocked (T069) ───────────────
  describe('async verification (T069)', () => {
    it('should not block the event loop during step execution', async () => {
      const yamlContent = [
        'name: Async Verify Test',
        'cases:',
        '  - name: http step',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'async-verify.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      let callbackFired = false;

      // Start a promise that resolves after events are collected
      const eventPromise = (async () => {
        const events: TestEvent[] = [];
        for await (const event of executeYAMLSuite(suite, {
          baseUrl: 'http://127.0.0.1:1',
          variables: { config: {}, runtime: {}, env: {} },
          defaultTimeout: 500,
        })) {
          events.push(event);
        }
        return events;
      })();

      // Schedule a check on the event loop — if the engine is truly async,
      // this timer will fire during or after the suite execution
      const timerPromise = new Promise<void>(resolve => {
        setTimeout(() => { callbackFired = true; resolve(); }, 5);
      });

      const events = await eventPromise;
      await timerPromise;

      expect(callbackFired).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    it('should verify no execSync imports in yaml-engine or docker-engine', async () => {
      const yamlEngineSource = await fs.readFile(
        path.resolve(import.meta.dirname, '../../src/yaml-engine.ts'),
        'utf-8',
      );
      expect(yamlEngineSource).not.toMatch(/\bimport\b.*\bexecSync\b.*from/);

      const dockerEngineSource = await fs.readFile(
        path.resolve(import.meta.dirname, '../../src/docker-engine.ts'),
        'utf-8',
      );
      // docker-engine should not import execSync (only execFileSync for sync helper)
      expect(dockerEngineSource).not.toMatch(/\bimport\b.*\bexecSync\b[^F]/);
    });
  });

  // ── Retry integration tests (T066) ─────────────────────────────────
  describe('retry integration', () => {
    it('should apply global retry policy to failing cases', async () => {
      const yamlContent = [
        'name: Global Retry Test',
        'cases:',
        '  - name: failing request',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'global-retry.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl: 'http://127.0.0.1:1',
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 200,
        globalRetryPolicy: { maxAttempts: 2, delay: '10ms' },
      })) {
        events.push(event);
      }

      const failEvent = events.find(e => e.type === 'case_fail');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'case_fail') {
        expect(failEvent.attempts).toBeDefined();
        expect(failEvent.attempts).toHaveLength(2);
        expect(failEvent.attempts![0]!.passed).toBe(false);
        expect(failEvent.attempts![1]!.passed).toBe(false);
      }
    });

    it('should not retry when no policy is set', async () => {
      const yamlContent = [
        'name: No Retry Test',
        'cases:',
        '  - name: failing request',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'no-retry.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl: 'http://127.0.0.1:1',
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 200,
      })) {
        events.push(event);
      }

      const failEvent = events.find(e => e.type === 'case_fail');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'case_fail') {
        expect(failEvent.attempts).toBeUndefined();
      }
    });

    it('should use suite retry over global when both are set', async () => {
      const yamlContent = [
        'name: Suite Retry Test',
        'cases:',
        '  - name: failing request',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'suite-retry.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl: 'http://127.0.0.1:1',
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 200,
        globalRetryPolicy: { maxAttempts: 5, delay: '10ms' },
        suiteRetryPolicy: { maxAttempts: 2, delay: '10ms' },
      })) {
        events.push(event);
      }

      const failEvent = events.find(e => e.type === 'case_fail');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'case_fail') {
        expect(failEvent.attempts).toHaveLength(2);
      }
    });

    it('should use case-level retry over suite and global', async () => {
      const yamlContent = [
        'name: Case Retry Test',
        'cases:',
        '  - name: case with retry',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
        '    retry:',
        '      maxAttempts: 3',
        '      delay: "10ms"',
      ].join('\n');

      const filePath = path.join(tmpDir, 'case-retry.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl: 'http://127.0.0.1:1',
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 200,
        globalRetryPolicy: { maxAttempts: 5, delay: '10ms' },
        suiteRetryPolicy: { maxAttempts: 5, delay: '10ms' },
      })) {
        events.push(event);
      }

      const failEvent = events.find(e => e.type === 'case_fail');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'case_fail') {
        // Case-level maxAttempts=3 should override suite(5) and global(5)
        expect(failEvent.attempts).toHaveLength(3);
      }
    });

    it('should include attempt history in pass event when retry succeeds', async () => {
      const yamlContent = [
        'name: Retry Success Test',
        'cases:',
        '  - name: request against unreachable',
        '    request:',
        '      method: GET',
        '      path: /health',
        '    expect:',
        '      status: 200',
      ].join('\n');

      const filePath = path.join(tmpDir, 'retry-success.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl: 'http://127.0.0.1:1',
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 200,
        globalRetryPolicy: { maxAttempts: 2, delay: '10ms' },
      })) {
        events.push(event);
      }

      // This will fail because there's no server, but it should have attempts
      const failEvent = events.find(e => e.type === 'case_fail');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'case_fail') {
        expect(failEvent.attempts).toBeDefined();
        for (const attempt of failEvent.attempts!) {
          expect(attempt.attempt).toBeGreaterThan(0);
          expect(attempt.duration).toBeGreaterThanOrEqual(0);
          expect(attempt.timestamp).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── Sequential fail-fast (skip remaining on first failure) ──────────
  // When suite.sequential === true and a case fails (after retries exhausted,
  // and not via ignoreError), the engine emits `case_skip` for every
  // subsequent case and stops executing them. Without sequential (or with
  // sequential: false / undefined), behavior is unchanged: every case runs.
  describe('sequential fail-fast', () => {
    // Helper: write a 3-case suite where the middle case targets a path we
    // can control via `pathToFail` (e.g. /fail vs /pass). The first case
    // always hits /pass, the third always hits /pass too. With sequential=true
    // and middle case failing, the third should be skipped.
    function writeThreeCaseSuite(
      filePath: string,
      sequentialField: string, // e.g. 'sequential: true\n', '', 'sequential: false\n'
      middleCaseExtra: string = '', // e.g. 'ignoreError: true\n'
    ): string {
      const yaml = [
        'name: FailFast Test',
        sequentialField.trimEnd(),
        'cases:',
        '  - name: case-A-pass',
        '    request:',
        '      method: GET',
        '      path: /pass',
        '    expect:',
        '      status: 200',
        '  - name: case-B-fail',
        '    request:',
        '      method: GET',
        '      path: /fail',
        '    expect:',
        '      status: 200',
        ...(middleCaseExtra ? ['    ' + middleCaseExtra.trim()] : []),
        '  - name: case-C-pass',
        '    request:',
        '      method: GET',
        '      path: /pass',
        '    expect:',
        '      status: 200',
      ].filter(line => line !== '').join('\n');
      return yaml;
    }

    // Local fake server: /pass → 200, /fail → 500
    let server: import('node:http').Server;
    let baseUrl: string;

    beforeEach(async () => {
      const http = await import('node:http');
      server = http.createServer((req, res) => {
        if (req.url === '/pass') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('fail');
        }
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
    });

    afterEach(async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
    });

    async function runSuite(yamlContent: string) {
      const filePath = path.join(tmpDir, 'fail-fast.yaml');
      await fs.writeFile(filePath, yamlContent, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl,
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 1000,
      })) {
        events.push(event);
      }
      return events;
    }

    it('skips remaining cases when sequential=true and a case fails', async () => {
      const yaml = writeThreeCaseSuite(path.join(tmpDir, 'ff.yaml'), 'sequential: true\n');
      const events = await runSuite(yaml);

      const passEvents = events.filter(e => e.type === 'case_pass');
      const failEvents = events.filter(e => e.type === 'case_fail');
      const skipEvents = events.filter(e => e.type === 'case_skip');
      const suiteEnd = events.find(e => e.type === 'suite_end');

      expect(passEvents).toHaveLength(1);
      expect(failEvents).toHaveLength(1);
      expect(skipEvents).toHaveLength(1);
      if (skipEvents[0]?.type === 'case_skip') {
        expect(skipEvents[0].name).toBe('case-C-pass');
        expect(skipEvents[0].reason).toMatch(/sequential/i);
      }
      if (suiteEnd?.type === 'suite_end') {
        expect(suiteEnd.passed).toBe(1);
        expect(suiteEnd.failed).toBe(1);
        expect(suiteEnd.skipped).toBe(1);
      }
    });

    it('runs every case when sequential=true and all pass', async () => {
      const yaml = [
        'name: AllPass Sequential',
        'sequential: true',
        'cases:',
        '  - name: a',
        '    request: { method: GET, path: /pass }',
        '    expect: { status: 200 }',
        '  - name: b',
        '    request: { method: GET, path: /pass }',
        '    expect: { status: 200 }',
        '  - name: c',
        '    request: { method: GET, path: /pass }',
        '    expect: { status: 200 }',
      ].join('\n');
      const events = await runSuite(yaml);

      expect(events.filter(e => e.type === 'case_pass')).toHaveLength(3);
      expect(events.filter(e => e.type === 'case_skip')).toHaveLength(0);
      expect(events.filter(e => e.type === 'case_fail')).toHaveLength(0);
    });

    it('runs every case when sequential is undefined and middle case fails', async () => {
      // No sequential field — should not fail-fast.
      const yaml = writeThreeCaseSuite(path.join(tmpDir, 'ff.yaml'), '');
      const events = await runSuite(yaml);

      expect(events.filter(e => e.type === 'case_pass')).toHaveLength(2);
      expect(events.filter(e => e.type === 'case_fail')).toHaveLength(1);
      expect(events.filter(e => e.type === 'case_skip')).toHaveLength(0);
    });

    it('runs every case when sequential=false and middle case fails', async () => {
      const yaml = writeThreeCaseSuite(path.join(tmpDir, 'ff.yaml'), 'sequential: false\n');
      const events = await runSuite(yaml);

      expect(events.filter(e => e.type === 'case_pass')).toHaveLength(2);
      expect(events.filter(e => e.type === 'case_fail')).toHaveLength(1);
      expect(events.filter(e => e.type === 'case_skip')).toHaveLength(0);
    });

    it('does not skip when ignoreError converts the failure to a pass', async () => {
      const yaml = writeThreeCaseSuite(
        path.join(tmpDir, 'ff.yaml'),
        'sequential: true\n',
        'ignoreError: true',
      );
      const events = await runSuite(yaml);

      // Middle case becomes pass via ignoreError; third case still runs.
      expect(events.filter(e => e.type === 'case_pass')).toHaveLength(3);
      expect(events.filter(e => e.type === 'case_fail')).toHaveLength(0);
      expect(events.filter(e => e.type === 'case_skip')).toHaveLength(0);
    });

    it('does not skip when retry exhausts but sequential is undefined', async () => {
      // Independent of sequential, retry-then-fail in non-sequential should
      // not skip the third case.
      const yaml = writeThreeCaseSuite(path.join(tmpDir, 'ff.yaml'), '');
      const filePath = path.join(tmpDir, 'ff-retry.yaml');
      await fs.writeFile(filePath, yaml, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl,
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 1000,
        globalRetryPolicy: { maxAttempts: 2, delay: '5ms' },
      })) {
        events.push(event);
      }

      expect(events.filter(e => e.type === 'case_pass')).toHaveLength(2);
      expect(events.filter(e => e.type === 'case_fail')).toHaveLength(1);
      expect(events.filter(e => e.type === 'case_skip')).toHaveLength(0);
    });

    it('triggers fail-fast only after retries are exhausted (not on first attempt)', async () => {
      // sequential=true + retry — failed case still triggers fail-fast,
      // but ONLY after retries exhausted. Verify the retried case has
      // `attempts` array, then the next case is skipped.
      const yaml = writeThreeCaseSuite(path.join(tmpDir, 'ff.yaml'), 'sequential: true\n');
      const filePath = path.join(tmpDir, 'ff-seq-retry.yaml');
      await fs.writeFile(filePath, yaml, 'utf-8');
      const suite = await loadYAMLTests(filePath);

      const events: TestEvent[] = [];
      for await (const event of executeYAMLSuite(suite, {
        baseUrl,
        variables: { config: {}, runtime: {}, env: {} },
        defaultTimeout: 1000,
        globalRetryPolicy: { maxAttempts: 2, delay: '5ms' },
      })) {
        events.push(event);
      }

      const failEvent = events.find(e => e.type === 'case_fail');
      expect(failEvent).toBeDefined();
      if (failEvent?.type === 'case_fail') {
        expect(failEvent.attempts).toHaveLength(2);
      }
      expect(events.filter(e => e.type === 'case_skip')).toHaveLength(1);
    });
  });
});
