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
  isContainerRunning,
  MultiServiceOrchestrator,
  type TestEvent,
  type TestSuiteConfig,
  type SuiteExecutionConfig,
  type AIFriendlyTestResult,
  type MockServiceConfig,
} from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';
import type { ProjectSession } from '../session.js';
import type { ResultFormatter } from '../formatters/result-formatter.js';
import type { PlatformServices } from '../server.js';
import { handleSetup } from './setup.js';

export interface RunResult {
  status: 'passed' | 'failed';
  /** CI-friendly exit code: 0 = all passed, 1 = one or more failures */
  exitCode: 0 | 1;
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
  /** True when failed cases were truncated to maxFailures limit. */
  truncated?: boolean;
  /** Total failed cases before truncation (only set when truncated=true). */
  totalFailedCases?: number;
  /** Non-fatal warnings encountered during the run (e.g. history write failure). */
  warnings?: string[];
}

/**
 * Handle the argus_run MCP tool call.
 * Executes all (or filtered) test suites and returns AI-friendly results.
 *
 * @param params - Tool input with projectPath, optional suite filter and parallel override
 * @param sessionManager - Session store for tracking project state
 * @param formatter - Converts raw TestEvents into AIFriendlyTestResult format
 * @returns Structured run result with per-suite/per-case outcomes and diagnostics
 * @throws {SessionError} SUITE_NOT_FOUND if filter matches nothing
 */
export async function handleRun(
  params: { projectPath: string; filter?: string; parallel?: boolean; maxFailures?: number },
  sessionManager: SessionManager,
  formatter: ResultFormatter,
  platform?: PlatformServices,
): Promise<RunResult> {
  const session = sessionManager.getOrThrow(params.projectPath);
  const autoWarnings = await ensureEnvironmentReady(session, sessionManager);

  const config = session.config;
  if (!config.tests?.suites || config.tests.suites.length === 0) {
    return {
      status: 'passed',
      exitCode: 0,
      totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
      duration: 0,
      suites: [],
      ...(autoWarnings.length > 0 ? { warnings: autoWarnings } : {}),
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

  const result = await executeSuites(suites, session, formatter, sessionManager.eventBus, platform, params.parallel, params.maxFailures ?? 20);
  if (autoWarnings.length > 0) {
    result.warnings = [...autoWarnings, ...(result.warnings ?? [])];
  }
  return result;
}

/**
 * Handle the argus_run_suite MCP tool call.
 * Executes a single test suite by ID and returns AI-friendly results.
 *
 * @param params - Tool input with projectPath and suiteId
 * @param sessionManager - Session store for tracking project state
 * @param formatter - Converts raw TestEvents into AIFriendlyTestResult format
 * @returns Structured run result for the single suite
 * @throws {SessionError} SUITE_NOT_FOUND if suiteId not found
 */
export async function handleRunSuite(
  params: { projectPath: string; suiteId: string; maxFailures?: number },
  sessionManager: SessionManager,
  formatter: ResultFormatter,
  platform?: PlatformServices,
): Promise<RunResult> {
  const session = sessionManager.getOrThrow(params.projectPath);
  const autoWarnings = await ensureEnvironmentReady(session, sessionManager);

  const config = session.config;
  const suites = (config.tests?.suites ?? []).filter(
    (s: TestSuiteConfig) => s.id === params.suiteId,
  );

  if (suites.length === 0) {
    throw new SessionError('SUITE_NOT_FOUND', `Suite "${params.suiteId}" not found in configuration`);
  }

  const result = await executeSuites(suites, session, formatter, sessionManager.eventBus, platform, undefined, params.maxFailures ?? 20);
  if (autoWarnings.length > 0) {
    result.warnings = [...autoWarnings, ...(result.warnings ?? [])];
  }
  return result;
}

/**
 * Ensure service (and image-based mock) containers are running before tests.
 *
 * Matches mock auto-start UX (issue #5): if the session is not `running`, or
 * any required container is missing/stopped, invoke `argus_setup` once instead
 * of letting every case fail with "No such container".
 */
export async function ensureEnvironmentReady(
  session: ProjectSession,
  sessionManager: SessionManager,
): Promise<string[]> {
  if (session.isTestOnly) return [];

  const orchestrator = new MultiServiceOrchestrator();
  const services = orchestrator.normalizeServices(session.config);
  const mocks = (session.config.mocks ?? {}) as Record<string, MockServiceConfig>;
  const hasInfrastructure = services.length > 0 || Object.keys(mocks).length > 0;
  if (!hasInfrastructure) return [];

  const missing: string[] = [];

  for (const svc of services) {
    if (!(await isContainerRunning(svc.container.name))) {
      missing.push(svc.container.name);
    }
  }

  for (const [name, mc] of Object.entries(mocks)) {
    if (mc.image && !(await isContainerRunning(name))) {
      missing.push(name);
    }
  }

  const needsSetup = session.state !== 'running' || missing.length > 0;
  if (!needsSetup) return [];

  const reason = session.state !== 'running'
    ? `Environment state is "${session.state}" (not running)`
    : `Container(s) not running: ${missing.join(', ')}`;

  await handleSetup({ projectPath: session.projectPath }, sessionManager);

  return [`${reason} — auto-started via argus_setup.`];
}

async function executeSuites(
  suites: TestSuiteConfig[],
  session: import('../session.js').ProjectSession,
  formatter: ResultFormatter,
  bus?: import('argusai-core').SSEBus,
  platform?: PlatformServices,
  parallelOverride?: boolean,
  maxFailures: number = 20,
): Promise<RunResult> {
  const totalStart = Date.now();
  const suiteResults: RunResult['suites'] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const warnings: string[] = [];

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

    // Aggregate results per suite.
    // M4 fix: derive duration from suite_start/suite_end events instead of
    // measuring after the fact (which yields ~0ms since execution is already done).
    for (const { suiteConfig } of suiteConfigs) {
      const suiteEvents = allEvents.filter(e => 'suite' in e && e.suite === suiteConfig.name);
      const startEv = suiteEvents.find(e => e.type === 'suite_start') as { timestamp: number } | undefined;
      const endEv   = suiteEvents.find(e => e.type === 'suite_end')   as { timestamp: number; duration?: number } | undefined;
      // Prefer the engine-reported duration; fall back to timestamp diff; then 0.
      const duration = endEv?.duration ?? (startEv && endEv ? endEv.timestamp - startEv.timestamp : 0);

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
        duration,
        passed: suitePassed,
        failed: suiteFailed,
        skipped: suiteSkipped,
        cases,
      });
    }
  }

  // ---- External-runner suites (vitest, pytest, shell, exec, playwright) ----
  // These runners are always sequential; parallel support requires runner-level changes.
  // M6 fix: create registry once outside the loop instead of once per suite.
  const registry = externalSuites.length > 0 ? await createDefaultRegistry() : null;

  for (const suiteConfig of externalSuites) {
    const events: TestEvent[] = [];
    const suiteStart = Date.now();

    const runner = registry?.get(suiteConfig.runner!);
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

  // Build a raw result (all cases, no truncation) for history persistence.
  // History needs the full record; the AI-facing response gets a trimmed version.
  const rawResult: RunResult = {
    status: totalFailed > 0 ? 'failed' : 'passed',
    exitCode: totalFailed > 0 ? 1 : 0,
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
        rawResult,
        session.config.project.name,
        session.projectPath,
        session.configPath,
        'mcp',
      );
    } catch (err) {
      // M5 fix: surface non-fatal history failures as warnings instead of silently
      // swallowing them. The run result is still returned; only persistence failed.
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('SQLITE_CORRUPT') || msg.includes('no such table') || msg.includes('schema')) {
        warnings.push(`History write failed (critical DB error): ${msg}. Run argus_rebuild to reset the environment.`);
      } else {
        warnings.push(`History write failed (transient): ${msg}`);
      }
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

  // A2 fix: build the AI-facing response with truncated failed cases to prevent
  // context overflow. Passed cases are represented by counts only.
  // History was already recorded from rawResult (the full, untruncated data).
  let truncated = false;
  let failedCasesEmitted = 0;
  const truncatedSuites = suiteResults.map(sr => {
    const failedCases = sr.cases.filter(c => c.status === 'failed');
    const skippedCases = sr.cases.filter(c => c.status === 'skipped');
    const remaining = maxFailures - failedCasesEmitted;
    const clippedFailed = failedCases.slice(0, Math.max(0, remaining));
    if (clippedFailed.length < failedCases.length) truncated = true;
    failedCasesEmitted += clippedFailed.length;
    return {
      ...sr,
      cases: [...clippedFailed, ...skippedCases],
    };
  });

  return {
    ...rawResult,
    suites: truncatedSuites,
    ...(truncated ? { truncated: true, totalFailedCases: totalFailed } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
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
