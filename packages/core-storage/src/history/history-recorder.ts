/**
 * @module history/history-recorder
 * Post-run recording orchestrator — persists test results and runs cleanup.
 */

import type { HistoryStore } from './history-store.js';
import type { HistoryConfig, TestRunRecord, TestCaseRunRecord, TriggerSource, FlakyInfo } from './types.js';
import { detectTriggerSource } from './types.js';
import { getGitContext } from './git-context.js';
import { computeConfigHash } from './config-hash.js';
import { FlakyDetector } from './flaky-detector.js';

/** Shape of a suite result from the run tool. */
export interface SuiteRunResult {
  id: string;
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: Array<{
    name: string;
    suite: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    timestamp: number;
    attempts?: Array<{ attempt: number; passed: boolean; duration: number }>;
    failure?: {
      error: string;
      request?: { method: string; url: string };
      response?: { status: number };
      assertions?: Array<{ passed: boolean }>;
      diagnostics?: { containerLogs?: Array<{ lines: string[] }> };
    };
  }>;
}

export interface RunInput {
  status: 'passed' | 'failed';
  duration: number;
  totals: { passed: number; failed: number; skipped: number };
  suites: SuiteRunResult[];
}

export interface RecordRunResult {
  runRecord: TestRunRecord;
  caseRecords: TestCaseRunRecord[];
  flakyResults: FlakyInfo[];
}

export class HistoryRecorder {
  constructor(
    private store: HistoryStore,
    private config: HistoryConfig,
  ) {}

  recordRun(
    runResult: RunInput,
    projectName: string,
    projectDir: string,
    configPath: string,
    triggerSource?: TriggerSource,
  ): RecordRunResult | null {
    try {
      const now = Date.now();
      const runId = `run-${now}-${randomSuffix()}`;
      const git = getGitContext(projectDir);
      const configHash = computeConfigHash(configPath);
      const trigger = detectTriggerSource(triggerSource);

      const runRecord: TestRunRecord = {
        id: runId,
        project: projectName,
        timestamp: now,
        gitCommit: git.commit,
        gitBranch: git.branch,
        configHash,
        trigger,
        duration: runResult.duration,
        passed: runResult.totals.passed,
        failed: runResult.totals.failed,
        skipped: runResult.totals.skipped,
        flaky: 0,
        status: runResult.status,
      };

      const caseRecords: TestCaseRunRecord[] = [];
      let caseIndex = 0;

      for (const suite of runResult.suites) {
        for (const c of suite.cases) {
          const caseId = `case-${now}-${suite.id}-${caseIndex++}`;
          const assertionCount = c.failure?.assertions?.length ?? null;
          const errorText = c.failure?.error ?? null;
          const snapshot = c.failure?.diagnostics
            ? JSON.stringify(c.failure.diagnostics).slice(0, 2000)
            : null;

          caseRecords.push({
            id: caseId,
            runId,
            suiteId: suite.id,
            caseName: c.name,
            status: c.status,
            duration: c.duration,
            attempts: c.attempts?.length ?? 1,
            responseMs: null,
            assertions: assertionCount,
            error: errorText ? errorText.slice(0, 2000) : null,
            snapshot,
          });
        }
      }

      this.store.saveRun(runRecord, caseRecords);

      // Analyze flakiness for failed cases
      const flakyResults: FlakyInfo[] = [];
      let flakyCount = 0;
      try {
        const detector = new FlakyDetector(this.store, this.config.flakyWindow);
        const failedCases = caseRecords.filter(c => c.status === 'failed');
        for (const fc of failedCases) {
          const info = detector.analyze(fc.caseName, projectName, fc.suiteId);
          flakyResults.push(info);
          if (info.isFlaky) flakyCount++;
        }
        if (flakyCount > 0) {
          runRecord.flaky = flakyCount;
        }
      } catch {
        // Flaky analysis failure is non-critical
      }

      try {
        this.store.cleanup(
          projectName,
          this.config.retention.maxAge,
          this.config.retention.maxRuns,
        );
      } catch {
        // Cleanup failure is non-critical
      }

      return { runRecord, caseRecords, flakyResults };
    } catch {
      // Graceful degradation per FR-017: history recording failure must not affect test execution
      return null;
    }
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
