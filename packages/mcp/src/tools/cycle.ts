/**
 * @module tools/cycle
 * argus_cycle — Full lifecycle orchestration: init → build → setup → run → diagnose? → clean?
 *
 * This is the "one call does everything" entry point for AI agents. It chains
 * the existing init/build/setup/run handlers, optionally triggers diagnose on
 * failure, and cleans up at the end (unless `keepEnvironment: true`).
 *
 * Phase results are emitted both as a final report and as SSE events on the
 * `cycle` channel so AI agents can stream progress via argus_subscribe.
 */

import type { SSEBus } from 'argusai-core';
import type { SessionManager } from '../session.js';
import type { ResultFormatter } from '../formatters/result-formatter.js';
import type { PlatformServices } from '../server.js';
import { handleInit } from './init.js';
import { handleBuild } from './build.js';
import { handleSetup } from './setup.js';
import { handleRun, type RunResult } from './run.js';
import { handleDiagnose } from './diagnose.js';
import { handleClean } from './clean.js';

export interface CycleParams {
  projectPath: string;
  configFile?: string;
  noCache?: boolean;
  filter?: string;
  parallel?: boolean;
  /** Per-runner timeout in ms (passed through to argus_run). */
  timeout?: number;
  /** Auto-call argus_diagnose on the first failing case. Default: true. */
  autoDiagnose?: boolean;
  /** Do not clean up at the end — leave environment running for manual debugging. Default: false. */
  keepEnvironment?: boolean;
  /** Pass through to argus_clean at the end. Default: false. */
  removeNetwork?: boolean;
  removeImages?: boolean;
  /** If true, do not execute — return a plan describing the cycle. Default: false. */
  dryRun?: boolean;
}

export type CyclePhaseName = 'init' | 'build' | 'setup' | 'run' | 'diagnose' | 'clean';

export interface CyclePhaseResult {
  name: CyclePhaseName;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  code?: string;
  /** Result payload (init/build/setup/run/clean result). */
  data?: unknown;
}

export interface CycleResult {
  status: 'passed' | 'failed' | 'aborted';
  phases: CyclePhaseResult[];
  /** Run result if run phase completed. */
  runResult?: RunResult;
  /** Diagnose result if diagnose phase ran. */
  diagnosis?: unknown;
  totalDuration: number;
  /** Final session state. */
  sessionState: string;
}

export async function handleCycle(
  params: CycleParams,
  sessionManager: SessionManager,
  formatter: ResultFormatter,
  platform?: PlatformServices,
): Promise<CycleResult> {
  const bus = sessionManager.eventBus;
  const autoDiagnose = params.autoDiagnose ?? true;
  const keepEnvironment = params.keepEnvironment ?? false;
  const totalStart = Date.now();

  const phases: CyclePhaseResult[] = [];

  const emitCycleEvent = (phase: CyclePhaseName, status: string, extra: Record<string, unknown> = {}) => {
    bus?.emit('cycle', {
      event: `phase_${status}`,
      data: { phase, status, project: params.projectPath, timestamp: Date.now(), ...extra },
    });
  };

  const planPhases: CyclePhaseName[] = ['init', 'build', 'setup', 'run'];
  if (autoDiagnose) planPhases.push('diagnose');
  if (!keepEnvironment) planPhases.push('clean');

  if (params.dryRun) {
    return {
      status: 'aborted',
      phases: planPhases.map((name) => ({ name, status: 'skipped', duration: 0 })),
      totalDuration: 0,
      sessionState: sessionManager.has(params.projectPath)
        ? sessionManager.getOrThrow(params.projectPath).state
        : 'none',
    };
  }

  // ---- Phase 1: init ----
  const initStart = Date.now();
  emitCycleEvent('init', 'start');
  try {
    const data = await handleInit({ projectPath: params.projectPath, ...(params.configFile ? { configFile: params.configFile } : {}) }, sessionManager);
    phases.push({ name: 'init', status: 'passed', duration: Date.now() - initStart, data });
    emitCycleEvent('init', 'end', { duration: Date.now() - initStart });
  } catch (err) {
    const duration = Date.now() - initStart;
    phases.push({ name: 'init', status: 'failed', duration, error: errMsg(err), ...extractCode(err) });
    emitCycleEvent('init', 'fail', { duration, error: errMsg(err) });
    return finish(phases, totalStart, sessionManager, params.projectPath, bus);
  }

  // ---- Phase 2: build ----
  const buildStart = Date.now();
  emitCycleEvent('build', 'start');
  try {
    const data = await handleBuild(
      { projectPath: params.projectPath, ...(params.noCache !== undefined ? { noCache: params.noCache } : {}) },
      sessionManager,
      platform,
    );
    phases.push({ name: 'build', status: 'passed', duration: Date.now() - buildStart, data });
    emitCycleEvent('build', 'end', { duration: Date.now() - buildStart });
  } catch (err) {
    const duration = Date.now() - buildStart;
    phases.push({ name: 'build', status: 'failed', duration, error: errMsg(err), ...extractCode(err) });
    emitCycleEvent('build', 'fail', { duration, error: errMsg(err) });
    return finish(phases, totalStart, sessionManager, params.projectPath, bus);
  }

  // ---- Phase 3: setup ----
  const setupStart = Date.now();
  emitCycleEvent('setup', 'start');
  try {
    const data = await handleSetup({ projectPath: params.projectPath }, sessionManager);
    phases.push({ name: 'setup', status: 'passed', duration: Date.now() - setupStart, data });
    emitCycleEvent('setup', 'end', { duration: Date.now() - setupStart });
  } catch (err) {
    const duration = Date.now() - setupStart;
    phases.push({ name: 'setup', status: 'failed', duration, error: errMsg(err), ...extractCode(err) });
    emitCycleEvent('setup', 'fail', { duration, error: errMsg(err) });
    return finish(phases, totalStart, sessionManager, params.projectPath, bus);
  }

  // ---- Phase 4: run ----
  const runStart = Date.now();
  let runResult: RunResult | undefined;
  emitCycleEvent('run', 'start');
  try {
    runResult = await handleRun(
      {
        projectPath: params.projectPath,
        ...(params.filter ? { filter: params.filter } : {}),
        ...(params.parallel !== undefined ? { parallel: params.parallel } : {}),
        ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
      },
      sessionManager,
      formatter,
      platform,
    );
    phases.push({
      name: 'run',
      status: runResult.status === 'passed' ? 'passed' : 'failed',
      duration: Date.now() - runStart,
      data: runResult,
    });
    emitCycleEvent('run', 'end', {
      duration: Date.now() - runStart,
      status: runResult.status,
      failed: runResult.totals.failed,
    });
  } catch (err) {
    const duration = Date.now() - runStart;
    phases.push({ name: 'run', status: 'failed', duration, error: errMsg(err), ...extractCode(err) });
    emitCycleEvent('run', 'fail', { duration, error: errMsg(err) });
    return finish(phases, totalStart, sessionManager, params.projectPath, bus);
  }

  // ---- Phase 5: diagnose (optional, only on run failure) ----
  let diagnosis: unknown;
  if (autoDiagnose && runResult && runResult.status === 'failed') {
    const diagStart = Date.now();
    emitCycleEvent('diagnose', 'start');
    try {
      const firstFailedSuite = runResult.suites.find((s) => s.status === 'failed');
      const firstFailedCase = firstFailedSuite?.cases.find((c) => c.status === 'failed');
      if (firstFailedSuite && firstFailedCase) {
        // Diagnosis requires a runId; if history is enabled the latest run id is
        // recorded by historyRecorder. We attempt to read it, but if unavailable
        // we skip diagnose rather than fail the cycle (best-effort).
        const session = sessionManager.getOrThrow(params.projectPath);
        const lastRun = (session.historyRecorder as unknown as { lastRunId?: string } | undefined)?.lastRunId;
        if (lastRun) {
          diagnosis = await handleDiagnose(
            { projectPath: params.projectPath, runId: lastRun, caseName: firstFailedCase.name },
            sessionManager,
          );
          phases.push({
            name: 'diagnose',
            status: 'passed',
            duration: Date.now() - diagStart,
            data: diagnosis,
          });
          emitCycleEvent('diagnose', 'end', { duration: Date.now() - diagStart });
        } else {
          phases.push({ name: 'diagnose', status: 'skipped', duration: Date.now() - diagStart });
        }
      } else {
        phases.push({ name: 'diagnose', status: 'skipped', duration: Date.now() - diagStart });
      }
    } catch (err) {
      const duration = Date.now() - diagStart;
      // Diagnose is best-effort — record but don't fail the cycle.
      phases.push({ name: 'diagnose', status: 'failed', duration, error: errMsg(err), ...extractCode(err) });
      emitCycleEvent('diagnose', 'fail', { duration, error: errMsg(err) });
    }
  } else {
    phases.push({ name: 'diagnose', status: 'skipped', duration: 0 });
  }

  // ---- Phase 6: clean (optional) ----
  if (!keepEnvironment) {
    const cleanStart = Date.now();
    emitCycleEvent('clean', 'start');
    try {
      const data = await handleClean(
        {
          projectPath: params.projectPath,
          ...(params.removeNetwork !== undefined ? { removeNetwork: params.removeNetwork } : {}),
          ...(params.removeImages !== undefined ? { removeImages: params.removeImages } : {}),
        },
        sessionManager,
      );
      phases.push({ name: 'clean', status: 'passed', duration: Date.now() - cleanStart, data });
      emitCycleEvent('clean', 'end', { duration: Date.now() - cleanStart });
    } catch (err) {
      const duration = Date.now() - cleanStart;
      phases.push({ name: 'clean', status: 'failed', duration, error: errMsg(err), ...extractCode(err) });
      emitCycleEvent('clean', 'fail', { duration, error: errMsg(err) });
    }
  } else {
    phases.push({ name: 'clean', status: 'skipped', duration: 0 });
  }

  return finish(phases, totalStart, sessionManager, params.projectPath, bus, runResult, diagnosis);
}

function finish(
  phases: CyclePhaseResult[],
  totalStart: number,
  sessionManager: SessionManager,
  projectPath: string,
  bus: SSEBus | undefined,
  runResult?: RunResult,
  diagnosis?: unknown,
): CycleResult {
  const anyFailed = phases.some((p) => p.status === 'failed');
  const sessionState = sessionManager.has(projectPath)
    ? sessionManager.getOrThrow(projectPath).state
    : 'none';
  const totalDuration = Date.now() - totalStart;
  const status = anyFailed ? 'failed' : runResult ? (runResult.status === 'passed' ? 'passed' : 'failed') : 'aborted';

  const result: CycleResult = {
    status,
    phases,
    totalDuration,
    sessionState,
  };
  if (runResult) result.runResult = runResult;
  if (diagnosis) result.diagnosis = diagnosis;

  bus?.emit('cycle', {
    event: 'cycle_end',
    data: { status, duration: totalDuration, phases: phases.length },
  });

  return result;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractCode(err: unknown): { code?: string } {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return { code: (err as { code: string }).code };
  }
  return {};
}