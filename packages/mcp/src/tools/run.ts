/**
 * @module tools/run
 * argus_run + argus_run_suite — Execute test suites.
 */

import path from 'node:path';
import {
  loadYAMLTests,
  executeYAMLSuite,
  executeSuitesWithParallel,
  createDefaultRegistry,
  type TestEvent,
  type TestSuiteConfig,
  type SuiteExecutionConfig,
  type AIFriendlyTestResult,
} from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';
import type { ResultFormatter } from '../formatters/result-formatter.js';
import type { PlatformServices } from '../server.js';

export interface RunResult {
  status: 'passed' | 'failed';
  totals: { passed: number; failed: number; skipped: number; total: number };
  duration: number;
  suites: Array<{
    id: string;
    name: string;
    status: 'passed' | 'failed';
    duration: number;
    passed: number;
    failed: number;
    skipped: number;
    cases: AIFriendlyTestResult[];
  }>;
}

/**
 * Handle the argus_run MCP tool call.
 * Executes all (or filtered) test suites and returns AI-friendly results.
 *
 * @param params - Tool input with projectPath, optional suite filter and parallel override
 * @param sessionManager - Session store for tracking project state
 * @param formatter - Converts raw TestEvents into AIFriendlyTestResult format
 * @returns Structured run result with per-suite/per-case outcomes and diagnostics
 * @throws {SessionError} NOT_RUNNING if setup not done, SUITE_NOT_FOUND if filter matches nothing
 */
export async function handleRun(
  params: { projectPath: string; filter?: string; parallel?: boolean },
  sessionManager: SessionManager,
  formatter: ResultFormatter,
  platform?: PlatformServices,
): Promise<RunResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (session.state !== 'running' && !session.isTestOnly) {
    throw new SessionError('NOT_RUNNING', 'Environment not set up. Call argus_setup first.');
  }

  const config = session.config;
  if (!config.tests?.suites || config.tests.suites.length === 0) {
    return {
      status: 'passed',
      totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
      duration: 0,
      suites: [],
    };
  }

  let suites = config.tests.suites;

  if (params.filter) {
    const filterIds = params.filter.split(',').map(s => s.trim());
    suites = suites.filter((s: TestSuiteConfig) => filterIds.includes(s.id));
    if (suites.length === 0) {
      throw new SessionError('SUITE_NOT_FOUND', `No suites found matching filter: ${params.filter}`);
    }
  }

  return executeSuites(suites, session, formatter, sessionManager.eventBus, platform, params.parallel);
}

/**
 * Handle the argus_run_suite MCP tool call.
 * Executes a single test suite by ID and returns AI-friendly results.
 *
 * @param params - Tool input with projectPath and suiteId
 * @param sessionManager - Session store for tracking project state
 * @param formatter - Converts raw TestEvents into AIFriendlyTestResult format
 * @returns Structured run result for the single suite
 * @throws {SessionError} NOT_RUNNING if setup not done, SUITE_NOT_FOUND if suiteId not found
 */
export async function handleRunSuite(
  params: { projectPath: string; suiteId: string },
  sessionManager: SessionManager,
  formatter: ResultFormatter,
  platform?: PlatformServices,
): Promise<RunResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (session.state !== 'running' && !session.isTestOnly) {
    throw new SessionError('NOT_RUNNING', 'Environment not set up. Call argus_setup first.');
  }

  const config = session.config;
  const suites = (config.tests?.suites ?? []).filter(
    (s: TestSuiteConfig) => s.id === params.suiteId,
  );

  if (suites.length === 0) {
    throw new SessionError('SUITE_NOT_FOUND', `Suite "${params.suiteId}" not found in configuration`);
  }

  return executeSuites(suites, session, formatter, sessionManager.eventBus, platform);
}

async function executeSuites(
  suites: TestSuiteConfig[],
  session: import('../session.js').ProjectSession,
  formatter: ResultFormatter,
  bus?: import('argusai-core').SSEBus,
  platform?: PlatformServices,
  parallelOverride?: boolean,
): Promise<RunResult> {
  const totalStart = Date.now();
  const suiteResults: RunResult['suites'] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  bus?.emit('activity', {
    event: 'activity_start',
    data: { id: `run-${totalStart}`, source: 'ai', operation: 'run', project: session.config.project.name, status: 'running', startTime: totalStart },
  });

  // Separate YAML suites from external-runner suites.
  // Only YAML suites support parallel execution via executeSuitesWithParallel.
  const yamlSuites = suites.filter(s => s.runner === 'yaml' || !s.runner);
  const externalSuites = suites.filter(s => s.runner && s.runner !== 'yaml');

  // ---- YAML suites (supports parallel execution) ----
  if (yamlSuites.length > 0) {
    // Build per-suite configs. parallelOverride=true forces all suites parallel;
    // otherwise respect each suite's own `parallel` flag.
    // Each suite resolves its own baseUrl / vars from the service field (F04 fix).
    const suiteConfigs: (SuiteExecutionConfig & { suiteConfig: TestSuiteConfig })[] = [];
    for (const suiteConfig of yamlSuites) {
      if (!suiteConfig.file) continue;
      const filePath = path.resolve(session.projectPath, suiteConfig.file);
      const yamlSuite = await loadYAMLTests(filePath);
      const svcName = suiteConfig.service;
      suiteConfigs.push({
        suite: yamlSuite,
        options: {
          baseUrl: getBaseUrl(session.config, svcName),
          variables: {
            config: getConfigVars(session.config, svcName),
            runtime: {},
            env: { ...process.env } as Record<string, string>,
          },
          containerName: getContainerName(session.config, svcName),
        },
        parallel: parallelOverride ?? (suiteConfig.parallel ?? false),
        suiteConfig,
      });
    }

    const allEvents: TestEvent[] = [];
    // executeSuitesWithParallel yields events from all suites in order
    for await (const event of executeSuitesWithParallel(suiteConfigs)) {
      allEvents.push(event);
      bus?.emit('test', { event: event.type, data: event });
    }

    // Aggregate results per suite by matching suite_start/suite_end events
    for (const { suiteConfig } of suiteConfigs) {
      const suiteStart = Date.now();
      const suiteEvents = allEvents.filter(e => 'suite' in e && e.suite === suiteConfig.name);
      const cases = formatter.formatEvents(suiteEvents, suiteConfig.name);
      let suitePassed = 0;
      let suiteFailed = 0;
      let suiteSkipped = 0;
      for (const c of cases) {
        if (c.status === 'passed') suitePassed++;
        else if (c.status === 'failed') suiteFailed++;
        else suiteSkipped++;
      }
      totalPassed += suitePassed;
      totalFailed += suiteFailed;
      totalSkipped += suiteSkipped;
      suiteResults.push({
        id: suiteConfig.id,
        name: suiteConfig.name,
        status: suiteFailed > 0 ? 'failed' : 'passed',
        duration: Date.now() - suiteStart,
        passed: suitePassed,
        failed: suiteFailed,
        skipped: suiteSkipped,
        cases,
      });
    }
  }

  // ---- External-runner suites (vitest, pytest, shell, exec, playwright) ----
  // These runners are always sequential; parallel support requires runner-level changes.
  for (const suiteConfig of externalSuites) {
    const events: TestEvent[] = [];
    const suiteStart = Date.now();

    const registry = await createDefaultRegistry();
    const runner = registry.get(suiteConfig.runner!);
    if (runner) {
      const cwd = session.projectPath;
      const target = suiteConfig.file ?? suiteConfig.command ?? '';
      for await (const event of runner.run({
        cwd,
        target,
        env: process.env as Record<string, string>,
        timeout: 300_000,
      })) {
        events.push(event);
        bus?.emit('test', { event: event.type, data: event });
      }
    }

    const cases = formatter.formatEvents(events, suiteConfig.name);
    let suitePassed = 0;
    let suiteFailed = 0;
    let suiteSkipped = 0;

    for (const c of cases) {
      if (c.status === 'passed') suitePassed++;
      else if (c.status === 'failed') suiteFailed++;
      else suiteSkipped++;
    }

    totalPassed += suitePassed;
    totalFailed += suiteFailed;
    totalSkipped += suiteSkipped;

    suiteResults.push({
      id: suiteConfig.id,
      name: suiteConfig.name,
      status: suiteFailed > 0 ? 'failed' : 'passed',
      duration: Date.now() - suiteStart,
      passed: suitePassed,
      failed: suiteFailed,
      skipped: suiteSkipped,
      cases,
    });
  }

  const total = totalPassed + totalFailed + totalSkipped;

  const totalDuration = Date.now() - totalStart;
  bus?.emit('activity', {
    event: 'activity_update',
    data: { id: `run-${totalStart}`, source: 'ai', operation: 'run', project: session.config.project.name, status: totalFailed > 0 ? 'failed' : 'success', startTime: totalStart, endTime: Date.now() },
  });

  const runResult: RunResult = {
    status: totalFailed > 0 ? 'failed' : 'passed',
    totals: { passed: totalPassed, failed: totalFailed, skipped: totalSkipped, total },
    duration: totalDuration,
    suites: suiteResults,
  };

  // --- Storage layer responsibilities (F03 fix) ---
  //
  // Two separate stores serve distinct purposes:
  //   1. DrizzleHistoryStore (session.historyRecorder) — the authoritative
  //      SQLite-backed store for all history/trends/flaky/diagnose queries.
  //      This is the ONLY store that should be used for persistent history.
  //
  //   2. legacy platform.store — a MemoryStore/FileStore used exclusively
  //      for real-time Dashboard SSE activity feeds and short-lived stats.
  //      It does NOT back any history queries. Only write here when Drizzle
  //      history is NOT enabled (e.g. memory storage mode without historyRecorder).
  //
  // Do NOT write to both stores for the same run to avoid duplicate records.

  if (session.historyRecorder) {
    // Primary path: persist via DrizzleHistoryStore
    try {
      session.historyRecorder.recordRun(
        runResult,
        session.config.project.name,
        session.projectPath,
        session.configPath,
        'mcp',
      );
    } catch {
      // Graceful degradation: history recording failure is non-critical
    }
  } else if (platform?.store) {
    // Fallback path: Drizzle not available (memory storage or history disabled).
    // Write to legacy store so the Dashboard still shows activity.
    for (const sr of suiteResults) {
      platform.store.saveTestRecord({
        id: `test-${totalStart}-${sr.id}`,
        project: session.projectPath,
        suite: sr.name,
        status: sr.failed > 0 ? 'failed' : sr.skipped === (sr.passed + sr.failed + sr.skipped) ? 'skipped' : 'passed',
        passed: sr.passed,
        failed: sr.failed,
        skipped: sr.skipped,
        duration: sr.duration,
        timestamp: totalStart,
        source: 'ai',
        error: sr.cases.find(c => c.status === 'failed')?.failure?.error,
      }).catch(() => {});
    }
  }

  // Notify on failure
  if (totalFailed > 0 && platform?.notifier) {
    const failedSuites = suiteResults.filter(s => s.status === 'failed').map(s => s.name);
    platform.notifier.notifyTestFailure(
      session.projectPath,
      failedSuites.join(', '),
      `${totalFailed} test(s) failed in: ${failedSuites.join(', ')}`,
    ).catch(() => {});
  }

  return runResult;
}

/**
 * Look up a service by name. Falls back to the first service if name is
 * undefined or not found. Returns undefined in test-only mode (no services).
 */
function resolveService(
  config: import('argusai-core').E2EConfig,
  serviceName?: string,
) {
  if (config.services && config.services.length > 0) {
    if (serviceName) {
      const named = config.services.find(s => s.name === serviceName);
      if (named) return named;
    }
    return config.services[0]!;
  }
  // Single-service mode — serviceName is ignored
  return config.service ?? undefined;
}

function getContainerName(
  config: import('argusai-core').E2EConfig,
  serviceName?: string,
): string | undefined {
  return resolveService(config, serviceName)?.container.name;
}

function getBaseUrl(
  config: import('argusai-core').E2EConfig,
  serviceName?: string,
): string {
  const svc = resolveService(config, serviceName);
  if (!svc) return 'http://localhost:3000';
  if (svc.vars?.['base_url']) return svc.vars['base_url'];

  const ports = svc.container.ports;
  if (ports.length > 0) {
    const hostPort = ports[0]!.split(':')[0];
    return `http://localhost:${hostPort}`;
  }
  return 'http://localhost:3000';
}

function getConfigVars(
  config: import('argusai-core').E2EConfig,
  serviceName?: string,
): Record<string, string> {
  const svc = resolveService(config, serviceName);
  return svc?.vars ? { ...svc.vars } : {};
}
