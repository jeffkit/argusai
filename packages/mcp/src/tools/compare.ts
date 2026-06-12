/**
 * @module tools/compare
 * argus_compare — Compare two test runs side-by-side to identify status changes.
 */

import type { TestRunRecord, ComparisonItem } from 'argusai-core';
import type { SessionManager } from '../session.js';

export interface CompareParams {
  projectPath: string;
  baseRunId: string;
  compareRunId: string;
}

export interface CompareResult {
  baseRun: TestRunRecord;
  compareRun: TestRunRecord;
  newFailures: ComparisonItem[];
  fixed: ComparisonItem[];
  consistent: { passed: number; failed: number; skipped: number };
  newCases: string[];
  removedCases: string[];
}

export async function handleCompare(
  params: CompareParams,
  sessionManager: SessionManager,
): Promise<CompareResult> {
  const session = await sessionManager.ensure(params.projectPath);

  if (!session.historyStore) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('HISTORY_DISABLED', 'History is disabled in project configuration');
  }

  const store = session.historyStore;

  const baseData = store.getRunById(params.baseRunId);
  if (!baseData) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('RUN_NOT_FOUND', `Base run not found: ${params.baseRunId}`);
  }

  const compareData = store.getRunById(params.compareRunId);
  if (!compareData) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('RUN_NOT_FOUND', `Compare run not found: ${params.compareRunId}`);
  }

  if (baseData.run.project !== compareData.run.project) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('DIFFERENT_PROJECTS', 'Cannot compare runs from different projects');
  }

  const baseCases = new Map(baseData.cases.map(c => [c.caseName, c]));
  const compareCases = new Map(compareData.cases.map(c => [c.caseName, c]));

  const newFailures: ComparisonItem[] = [];
  const fixed: ComparisonItem[] = [];
  const consistent = { passed: 0, failed: 0, skipped: 0 };
  const newCases: string[] = [];
  const removedCases: string[] = [];

  for (const [caseName, compareCase] of compareCases) {
    const baseCase = baseCases.get(caseName);

    if (!baseCase) {
      newCases.push(caseName);
      continue;
    }

    if (baseCase.status !== 'failed' && compareCase.status === 'failed') {
      newFailures.push({
        caseName,
        suiteId: compareCase.suiteId,
        error: compareCase.error,
        baseStatus: baseCase.status,
        compareStatus: 'failed',
      });
    } else if (baseCase.status === 'failed' && compareCase.status === 'passed') {
      fixed.push({
        caseName,
        suiteId: compareCase.suiteId,
        baseStatus: 'failed',
        compareStatus: 'passed',
      });
    } else {
      if (compareCase.status === 'passed') consistent.passed++;
      else if (compareCase.status === 'failed') consistent.failed++;
      else consistent.skipped++;
    }
  }

  for (const caseName of baseCases.keys()) {
    if (!compareCases.has(caseName)) {
      removedCases.push(caseName);
    }
  }

  return {
    baseRun: baseData.run,
    compareRun: compareData.run,
    newFailures,
    fixed,
    consistent,
    newCases,
    removedCases,
  };
}
