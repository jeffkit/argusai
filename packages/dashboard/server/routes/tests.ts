/**
 * 测试运行路由
 *
 * 基于原版 as-mate/e2e 迁移，改为 e2e.yaml 配置驱动。
 * 支持 SSE 实时输出、测试历史、多种运行器。
 */

import { type FastifyPluginAsync } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import type { E2EConfig, TestSuiteConfig, TestEvent } from 'argusai-core';
import { loadYAMLTests, executeYAMLSuite, HistoryRecorder, HistoryConfigSchema } from 'argusai-core';
import type { RunInput } from 'argusai-core';
import { getAppState, addActivity, updateActivity } from '../app-state.js';

/** 去除 ANSI 转义码 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/** Format a TestEvent to a human-readable log line */
function formatTestEvent(event: TestEvent): string {
  switch (event.type) {
    case 'suite_start':
      return `\n=== Suite: ${event.suite} ===\n`;
    case 'suite_end':
      return `\n=== ${event.suite}: ${event.passed} passed, ${event.failed} failed (${event.duration}ms) ===\n`;
    case 'case_start':
      return `  ▶ ${event.name}`;
    case 'case_pass':
      return `  ✓ ${event.name} (${event.duration}ms)`;
    case 'case_fail':
      return `  ✗ FAIL: ${event.name} (${event.duration}ms)\n    ${event.error}`;
    case 'log':
      return `  [${event.level}] ${event.message}`;
    default:
      return JSON.stringify(event);
  }
}

interface TestResult {
  id: string;
  suite: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  startTime: number;
  endTime?: number;
  output: string[];
  exitCode?: number;
}

// Test history
const testHistory: TestResult[] = [];
let currentTest: TestResult | null = null;

export const testRoutes: FastifyPluginAsync = async (app) => {
  /** Build suites map from current config */
  function getSuites(): Record<string, TestSuiteConfig & { description: string }> {
    const config = getAppState().config;
    const suites: Record<string, TestSuiteConfig & { description: string }> = {};
    if (config?.tests?.suites) {
      for (const suite of config.tests.suites) {
        suites[suite.id] = { ...suite, description: suite.name };
      }
    }
    suites['all'] = {
      id: 'all',
      name: '全部测试',
      description: '运行所有 E2E 测试套件',
      file: config?.tests?.suites?.[0]?.file?.replace(/[^/]+$/, '') || 'tests/',
    };
    return suites;
  }

  /** 获取可用测试套件列表 */
  app.get('/suites', async () => {
    const suites = getSuites();
    return {
      suites: Object.entries(suites).map(([id, suite]) => ({
        id,
        name: suite.name,
        description: suite.description,
        file: suite.file || '',
        runner: suite.runner || 'vitest',
      })),
    };
  });

  /** 运行测试套件 */
  app.post('/run', async (request) => {
    const { config, configDir } = getAppState();
    const suites = getSuites();
    const body = request.body as { suite?: string; containerUrl?: string; command?: string } | undefined;
    const suiteId = body?.suite || 'all';
    const containerUrl = body?.containerUrl || config?.service?.vars?.base_url || 'http://localhost:3000';

    if (currentTest?.status === 'running') {
      return { success: false, error: 'A test is already running' };
    }

    const suite = suites[suiteId];
    if (!suite) {
      return { success: false, error: `Unknown test suite: ${suiteId}` };
    }

    const testId = `${suiteId}-${Date.now()}`;
    currentTest = {
      id: testId,
      suite: suiteId,
      status: 'running',
      startTime: Date.now(),
      output: [],
    };

    // Determine how to run the test
    const runner = suite.runner || (suite.file?.endsWith('.yaml') || suite.file?.endsWith('.yml') ? 'yaml' : 'vitest');
    const dashboardPort = process.env.E2E_PORT || String(config?.dashboard?.port ?? '9095');
    const dashboardUrl = `http://localhost:${dashboardPort}`;

    // YAML runner: use built-in yaml-engine directly (no subprocess)
    if (runner === 'yaml') {
      const testFile = path.resolve(configDir, suite.file || '');
      const baseUrl = containerUrl;

      const activityId = `run-manual-${Date.now()}`;
      addActivity({ id: activityId, source: 'manual', operation: 'run', project: config?.project.name ?? 'unknown', status: 'running', startTime: Date.now() });

      (async () => {
        try {
          const yamlSuite = await loadYAMLTests(testFile);
          const containerName = config?.service?.container?.name || 'e2e-container';
          const { eventBus } = getAppState();
          const events = executeYAMLSuite(yamlSuite, {
            baseUrl,
            variables: { config: {}, runtime: {}, env: { BASE_URL: baseUrl, E2E_DASHBOARD_URL: dashboardUrl } },
            defaultTimeout: 30_000,
            containerName,
          });

          for await (const event of events) {
            const line = formatTestEvent(event);
            currentTest?.output.push(line);
            eventBus.emit('test', { event: event.type, data: event });
          }

          if (currentTest) {
            currentTest.endTime = Date.now();
            const hasFailure = currentTest.output.some(l => l.includes('FAIL') || l.includes('✗'));
            currentTest.status = hasFailure ? 'failed' : 'passed';
            currentTest.exitCode = hasFailure ? 1 : 0;
            testHistory.unshift(currentTest);
            if (testHistory.length > 50) testHistory.length = 50;
            updateActivity(activityId, { status: hasFailure ? 'failed' : 'success', endTime: Date.now() });

            recordDashboardRun(currentTest, suiteId, config);
            currentTest = null;
          }
        } catch (err) {
          if (currentTest) {
            currentTest.endTime = Date.now();
            currentTest.status = 'error';
            currentTest.exitCode = 1;
            currentTest.output.push(`Error: ${(err as Error).message}`);
            testHistory.unshift(currentTest);
            if (testHistory.length > 50) testHistory.length = 50;
            updateActivity(activityId, { status: 'failed', endTime: Date.now() });
            currentTest = null;
          }
        }
      })();

      return { success: true, testId, suite: suiteId, runner: 'yaml' };
    }

    let proc;

    if (runner === 'vitest') {
      // Default: vitest
      const vitestArgs = [
        'run',
        '--reporter=verbose',
      ];

      // Add config file if specified
      if (suite.config) {
        vitestArgs.push('--config', suite.config);
      }

      // Add specific test file unless running all
      if (suiteId !== 'all' && suite.file) {
        vitestArgs.push(suite.file);
      }

      proc = spawn('npx', ['vitest', ...vitestArgs], {
        cwd: configDir,
        env: {
          ...process.env,
          E2E_CONTAINER_URL: containerUrl,
          E2E_DASHBOARD_URL: dashboardUrl,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          CI: '1',
          TERM: 'dumb',
        },
      });
    } else if (runner === 'shell' || runner === 'exec') {
      const command = suite.command || body?.command || `echo "No command specified for ${suiteId}"`;
      proc = spawn('sh', ['-c', command], {
        cwd: configDir,
        env: {
          ...process.env,
          E2E_CONTAINER_URL: containerUrl,
          E2E_DASHBOARD_URL: dashboardUrl,
        },
      });
    } else if (runner === 'pytest') {
      const file = suite.file || 'tests/';
      proc = spawn('python', ['-m', 'pytest', '-v', file], {
        cwd: configDir,
        env: {
          ...process.env,
          E2E_CONTAINER_URL: containerUrl,
          E2E_DASHBOARD_URL: dashboardUrl,
        },
      });
    } else {
      // Generic command runner
      const command = suite.command || `npx vitest run ${suite.file || ''}`;
      proc = spawn('sh', ['-c', command], {
        cwd: configDir,
        env: {
          ...process.env,
          E2E_CONTAINER_URL: containerUrl,
          E2E_DASHBOARD_URL: dashboardUrl,
        },
      });
    }

    proc.stdout.on('data', (data: Buffer) => {
      const line = stripAnsi(data.toString());
      currentTest?.output.push(line);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const line = stripAnsi(data.toString());
      currentTest?.output.push(line);
    });

    proc.on('close', (code) => {
      if (currentTest) {
        currentTest.endTime = Date.now();
        currentTest.exitCode = code ?? undefined;
        currentTest.status = code === 0 ? 'passed' : 'failed';
        testHistory.unshift(currentTest);
        if (testHistory.length > 50) testHistory.length = 50;
        currentTest = null;
      }
    });

    return { success: true, testId, suite: suiteId };
  });

  /** 获取当前运行中的测试状态 */
  app.get('/current', async () => {
    return { test: currentTest };
  });

  /** 获取测试历史 */
  app.get('/history', async (request) => {
    const { limit } = request.query as { limit?: string };
    const n = parseInt(limit || '20');
    return { tests: testHistory.slice(0, n) };
  });

  /** 获取指定测试结果 */
  app.get('/result/:testId', async (request) => {
    const { testId } = request.params as { testId: string };
    const test = testHistory.find((t) => t.id === testId) ||
      (currentTest?.id === testId ? currentTest : null);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }
    return { success: true, test };
  });

  /** 获取测试套件的 YAML 文件内容及解析后的用例列表 */
  app.get('/suites/:suiteId/content', async (request) => {
    const { configDir, config } = getAppState();
    const { suiteId } = request.params as { suiteId: string };

    const suites = getSuites();
    const suite = suites[suiteId];
    if (!suite || suiteId === 'all') {
      return { success: false, error: `Unknown suite: ${suiteId}` };
    }

    const filePath = suite.file ? path.resolve(configDir, suite.file) : null;
    if (!filePath) {
      return { success: false, error: 'Suite has no file defined' };
    }

    try {
      const fs = await import('fs');
      const raw = fs.readFileSync(filePath, 'utf-8');

      // Also parse to get structured cases
      let parsed: Record<string, unknown> | null = null;
      try {
        const yamlSuite = await loadYAMLTests(filePath);
        parsed = {
          name: yamlSuite.name,
          description: yamlSuite.description,
          variables: yamlSuite.variables,
          setup: yamlSuite.setup,
          teardown: yamlSuite.teardown,
          cases: yamlSuite.cases,
          caseCount: yamlSuite.cases.length,
        };
      } catch { /* ignore parse errors, still return raw */ }

      return {
        success: true,
        raw,
        parsed,
        filePath,
        runner: suite.runner || (suite.file?.endsWith('.yaml') || suite.file?.endsWith('.yml') ? 'yaml' : 'vitest'),
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to read ${filePath}: ${(err as Error).message}`,
      };
    }
  });

  /** 保存测试套件的 YAML 文件内容 */
  app.put('/suites/:suiteId/content', async (request) => {
    const { configDir } = getAppState();
    const { suiteId } = request.params as { suiteId: string };
    const body = request.body as { content: string };

    const suites = getSuites();
    const suite = suites[suiteId];
    if (!suite || suiteId === 'all') {
      return { success: false, error: `Unknown suite: ${suiteId}` };
    }

    const filePath = suite.file ? path.resolve(configDir, suite.file) : null;
    if (!filePath) {
      return { success: false, error: 'Suite has no file defined' };
    }

    try {
      const fs = await import('fs');

      // Backup before saving
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, filePath + '.bak');
      }

      fs.writeFileSync(filePath, body.content, 'utf-8');

      // Validate the new content
      try {
        await loadYAMLTests(filePath);
      } catch (err) {
        // Restore backup if validation fails
        if (fs.existsSync(filePath + '.bak')) {
          fs.copyFileSync(filePath + '.bak', filePath);
        }
        return {
          success: false,
          error: `Validation failed: ${(err as Error).message}. Changes reverted.`,
        };
      }

      return { success: true, message: 'Test file saved successfully' };
    } catch (err) {
      return {
        success: false,
        error: `Failed to save: ${(err as Error).message}`,
      };
    }
  });

  /** 从测试 YAML 自动发现 API 端点 */
  app.get('/discovered-endpoints', async () => {
    const { configDir, config } = getAppState();
    if (!config?.tests?.suites) return { endpoints: [] };

    const fs = await import('fs');
    const groupMap = new Map<string, Array<{ method: string; path: string; name: string; body?: unknown }>>();

    for (const suite of config.tests.suites) {
      if (!suite.file || suite.runner === 'playwright') continue;
      const filePath = path.resolve(configDir, suite.file);
      if (!fs.existsSync(filePath)) continue;

      try {
        const yamlSuite = await loadYAMLTests(filePath);
        const groupName = suite.name;
        const endpoints: Array<{ method: string; path: string; name: string; body?: unknown }> = [];
        const seen = new Set<string>();

        for (const tc of yamlSuite.cases) {
          const tcAny = tc as unknown as Record<string, unknown>;
          const req = tcAny.request as { method?: string; url?: string; path?: string; body?: unknown } | undefined;
          if (!req) continue;

          const rawUrl = req.url || req.path || '';
          if (!rawUrl) continue;

          const apiPath = rawUrl
            .replace(/\{\{config\.base_url\}\}/g, '')
            .replace(/\{\{runtime\.[^}]+\}\}/g, ':id')
            .replace(/^\//, '');
          if (!apiPath || apiPath.startsWith('http')) continue;

          const method = (req.method || 'GET').toUpperCase();
          const key = `${method}:${apiPath}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const ep: { method: string; path: string; name: string; body?: unknown } = {
            method,
            path: apiPath,
            name: tc.name || `${method} ${apiPath}`,
          };
          if (req.body && method !== 'GET') ep.body = req.body;
          endpoints.push(ep);
        }

        if (endpoints.length > 0) {
          groupMap.set(groupName, endpoints);
        }
      } catch { /* skip broken files */ }
    }

    const groups = Array.from(groupMap.entries()).map(([group, endpoints]) => ({ group, endpoints }));
    return { endpoints: groups };
  });

  /** 从 OpenAPI/Swagger 规范自动发现 API 端点 */
  app.get('/openapi-endpoints', async (request) => {
    const { config } = getAppState();
    const query = request.query as { url?: string };

    const specUrl = query.url
      || (config as unknown as Record<string, unknown>)?.openapi?.specUrl as string | undefined
      || `${config?.service?.vars?.base_url || 'http://localhost:4936'}/api-docs.json`;

    try {
      const res = await fetch(specUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return { success: false, error: `Failed to fetch OpenAPI spec: ${res.status}`, specUrl };
      }

      const spec = await res.json() as {
        info?: { title?: string; version?: string };
        paths?: Record<string, Record<string, {
          tags?: string[];
          summary?: string;
          operationId?: string;
          requestBody?: {
            content?: Record<string, { schema?: unknown; example?: unknown }>;
          };
          parameters?: Array<{ name: string; in: string; required?: boolean; schema?: unknown }>;
        }>>;
      };

      if (!spec.paths) {
        return { success: false, error: 'No paths found in OpenAPI spec', specUrl };
      }

      const tagGroups = new Map<string, Array<{
        method: string;
        path: string;
        name: string;
        description?: string;
        body?: unknown;
        parameters?: Array<{ name: string; in: string; required?: boolean }>;
      }>>();

      for (const [apiPath, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method.toLowerCase()) < 0) continue;

          const tag = operation.tags?.[0] || 'Default';
          if (!tagGroups.has(tag)) tagGroups.set(tag, []);

          const cleanPath = apiPath.replace(/^\//, '');
          const ep: {
            method: string;
            path: string;
            name: string;
            description?: string;
            body?: unknown;
            parameters?: Array<{ name: string; in: string; required?: boolean }>;
          } = {
            method: method.toUpperCase(),
            path: cleanPath,
            name: operation.summary || operation.operationId || `${method.toUpperCase()} ${apiPath}`,
          };

          if (operation.requestBody?.content) {
            const jsonContent = operation.requestBody.content['application/json'];
            if (jsonContent?.example) {
              ep.body = jsonContent.example;
            }
          }

          if (operation.parameters?.length) {
            ep.parameters = operation.parameters.map(p => ({
              name: p.name, in: p.in, required: p.required,
            }));
          }

          tagGroups.get(tag)!.push(ep);
        }
      }

      const groups = Array.from(tagGroups.entries()).map(([group, endpoints]) => ({ group, endpoints }));
      return {
        success: true,
        specUrl,
        info: spec.info,
        endpoints: groups,
        totalEndpoints: groups.reduce((sum, g) => sum + g.endpoints.length, 0),
      };
    } catch (err) {
      return { success: false, error: `OpenAPI fetch failed: ${(err as Error).message}`, specUrl };
    }
  });

  /** SSE 实时测试输出 */
  app.get('/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const interval = setInterval(() => {
      if (currentTest) {
        reply.raw.write(
          `event: test-update\ndata: ${JSON.stringify({
            id: currentTest.id,
            status: currentTest.status,
            output: currentTest.output,
            duration: Date.now() - currentTest.startTime,
          })}\n\n`,
        );
      }
    }, 1000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });
};

function recordDashboardRun(
  test: TestResult,
  suiteId: string,
  config: E2EConfig | null,
): void {
  try {
    const appState = getAppState();
    if (!appState.historyStore || !config) return;

    const rawHistory = (config as unknown as Record<string, unknown>)['history'];
    const historyConfig = HistoryConfigSchema.parse(rawHistory ?? {});
    if (!historyConfig.enabled) return;

    const recorder = new HistoryRecorder(appState.historyStore, historyConfig);
    const duration = (test.endTime ?? Date.now()) - test.startTime;
    const status = test.status === 'passed' ? 'passed' as const : 'failed' as const;

    const runInput: RunInput = {
      status,
      duration,
      totals: { passed: status === 'passed' ? 1 : 0, failed: status === 'failed' ? 1 : 0, skipped: 0 },
      suites: [{
        id: suiteId,
        name: suiteId,
        status,
        duration,
        passed: status === 'passed' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        skipped: 0,
        cases: [{
          name: `${suiteId} (dashboard run)`,
          suite: suiteId,
          status,
          duration,
          timestamp: test.startTime,
        }],
      }],
    };

    recorder.recordRun(
      runInput,
      config.project.name,
      appState.configDir,
      appState.configPath ?? '',
      'dashboard',
    );
  } catch {
    // Graceful degradation: recording failure must not affect dashboard
  }
}
