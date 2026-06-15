/**
 * @module history/memory-history-store
 * In-memory Map-based implementation of HistoryStore for tests and CI mode.
 */

import type { TestRunRecord, TestCaseRunRecord } from './types.js';
import type { HistoryStore, GetRunsOptions, GetRunsResult } from './history-store.js';

export class MemoryHistoryStore implements HistoryStore {
  private runs = new Map<string, TestRunRecord>();
  private cases = new Map<string, TestCaseRunRecord[]>();

  saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void {
    this.runs.set(run.id, { ...run });
    this.cases.set(run.id, cases.map(c => ({ ...c })));
  }

  getRuns(project: string, options: GetRunsOptions): GetRunsResult {
    let filtered = [...this.runs.values()].filter(r => r.project === project);

    if (options.status) {
      filtered = filtered.filter(r => r.status === options.status);
    }
    if (options.days) {
      const cutoffMs = Date.now() - options.days * 24 * 60 * 60 * 1000;
      filtered = filtered.filter(r => r.timestamp >= cutoffMs);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    const total = filtered.length;
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = options.offset ?? 0;

    return {
      runs: filtered.slice(offset, offset + limit),
      total,
    };
  }

  getRunById(id: string): { run: TestRunRecord; cases: TestCaseRunRecord[] } | null {
    const run = this.runs.get(id);
    if (!run) return null;
    return { run: { ...run }, cases: (this.cases.get(id) ?? []).map(c => ({ ...c })) };
  }

  getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[] {
    const projectRuns = [...this.runs.values()]
      .filter(r => r.project === project)
      .sort((a, b) => b.timestamp - a.timestamp);

    const results: TestCaseRunRecord[] = [];
    for (const run of projectRuns) {
      if (results.length >= limit) break;
      const runCases = this.cases.get(run.id) ?? [];
      for (const c of runCases) {
        if (c.caseName === caseName && (!suiteId || c.suiteId === suiteId)) {
          results.push({ ...c });
          if (results.length >= limit) break;
        }
      }
    }
    return results;
  }

  getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[] {
    return [...this.runs.values()]
      .filter(r => r.project === project && r.timestamp >= fromMs && r.timestamp <= toMs)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getCasesForRun(runId: string): TestCaseRunRecord[] {
    return (this.cases.get(runId) ?? []).map(c => ({ ...c }));
  }

  getDistinctCaseNames(project: string, options?: { suiteId?: string; limit?: number }): string[] {
    const names = new Set<string>();
    const projectRuns = [...this.runs.values()].filter(r => r.project === project);

    for (const run of projectRuns) {
      const runCases = this.cases.get(run.id) ?? [];
      for (const c of runCases) {
        if (!options?.suiteId || c.suiteId === options.suiteId) {
          names.add(c.caseName);
        }
      }
    }

    const sorted = [...names].sort();
    return options?.limit ? sorted.slice(0, options.limit) : sorted;
  }

  cleanup(project: string, maxAge: string, maxRuns: number): number {
    let totalDeleted = 0;

    const daysMatch = maxAge.match(/^(\d+)d$/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]!, 10);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      for (const [id, run] of this.runs) {
        if (run.project === project && run.timestamp < cutoffMs) {
          this.runs.delete(id);
          this.cases.delete(id);
          totalDeleted++;
        }
      }
    }

    const projectRuns = [...this.runs.values()]
      .filter(r => r.project === project)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (projectRuns.length > maxRuns) {
      const toRemove = projectRuns.slice(maxRuns);
      for (const run of toRemove) {
        this.runs.delete(run.id);
        this.cases.delete(run.id);
        totalDeleted++;
      }
    }

    return totalDeleted;
  }

  close(): void {
    this.runs.clear();
    this.cases.clear();
  }
}
