import { hostname } from 'node:os';
import type { HistoryStore, GetRunsOptions, GetRunsResult } from '../history/history-store.js';
import type { TestRunRecord, TestCaseRunRecord } from '../history/types.js';
import type { ServerConfig } from '../types.js';
import type { SyncQueue } from './sync-queue.js';

export interface SyncPattern {
  category: string;
  signature: string;
  signaturePattern: string;
  description: string;
  suggestedFix: string;
  confidence: number;
  source: 'built-in' | 'learned';
}

/**
 * Decorator that wraps a local HistoryStore with async sync queue enqueuing.
 * All reads go to the local store; writes go local + enqueue for server sync.
 */
export class RemoteHistoryStore implements HistoryStore {
  private pendingPatterns: SyncPattern[] = [];

  constructor(
    private local: HistoryStore,
    private syncQueue: SyncQueue,
    private serverConfig: ServerConfig,
  ) {}

  /**
   * Attach patterns to be included in the next saveRun sync payload.
   * Call this before saveRun() when patterns were discovered during the run.
   */
  attachPatterns(patterns: SyncPattern[]): void {
    this.pendingPatterns = patterns;
  }

  saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void {
    this.local.saveRun(run, cases);

    const patterns = this.pendingPatterns;
    this.pendingPatterns = [];

    try {
      const payload: Record<string, any> = {
        project: run.project,
        team: this.serverConfig.team,
        sourceDeveloper: hostname(),
        run: {
          id: run.id,
          timestamp: run.timestamp,
          gitCommit: run.gitCommit,
          gitBranch: run.gitBranch,
          configHash: run.configHash,
          trigger: run.trigger,
          duration: run.duration,
          passed: run.passed,
          failed: run.failed,
          skipped: run.skipped,
          flaky: run.flaky,
          status: run.status,
        },
        cases: cases.map((c) => ({
          id: c.id,
          suiteId: c.suiteId,
          caseName: c.caseName,
          status: c.status,
          duration: c.duration,
          attempts: c.attempts,
          responseMs: c.responseMs,
          assertions: c.assertions,
          error: c.error ? c.error.slice(0, 2000) : null,
          snapshot: c.snapshot,
        })),
      };

      if (patterns.length > 0) {
        payload.patterns = patterns;
      }

      this.syncQueue.enqueue('run', payload);
    } catch (err) {
      console.warn(
        `[sync] Failed to enqueue run ${run.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  getRuns(project: string, options: GetRunsOptions): GetRunsResult {
    return this.local.getRuns(project, options);
  }

  getRunById(id: string): { run: TestRunRecord; cases: TestCaseRunRecord[] } | null {
    return this.local.getRunById(id);
  }

  getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[] {
    return this.local.getCaseHistory(caseName, project, limit, suiteId);
  }

  getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[] {
    return this.local.getRunsInDateRange(project, fromMs, toMs);
  }

  getCasesForRun(runId: string): TestCaseRunRecord[] {
    return this.local.getCasesForRun(runId);
  }

  getDistinctCaseNames(project: string, options?: { suiteId?: string; limit?: number }): string[] {
    return this.local.getDistinctCaseNames(project, options);
  }

  cleanup(project: string, maxAge: string, maxRuns: number): number {
    return this.local.cleanup(project, maxAge, maxRuns);
  }

  close(): void {
    this.local.close();
  }
}
