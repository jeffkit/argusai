/**
 * @module history/flaky-detector
 * Analyzes test case history to detect flaky tests using a sliding-window
 * ratio algorithm and classifies stability levels.
 */

import type { HistoryStore } from './history-store.js';
import type { FlakyInfo, StabilityLevel } from './types.js';

export class FlakyDetector {
  constructor(
    private store: HistoryStore,
    private flakyWindow: number = 10,
  ) {}

  /**
   * Analyze a single test case's recent history to determine flakiness.
   * Returns STABLE with empty results when fewer than 2 historical runs exist.
   */
  analyze(caseName: string, project: string, suiteId?: string): FlakyInfo {
    const history = this.store.getCaseHistory(caseName, project, this.flakyWindow, suiteId);

    if (history.length < 2) {
      return {
        caseName,
        suiteId: suiteId ?? (history[0]?.suiteId ?? ''),
        isFlaky: false,
        score: 0,
        level: 'STABLE',
        recentResults: history.map(h => h.status),
        suggestion: 'Insufficient history for analysis.',
        failCount: 0,
        totalRuns: history.length,
      };
    }

    const totalRuns = history.length;
    const failCount = history.filter(h => h.status === 'failed').length;
    const score = failCount / totalRuns;
    const level = classifyStability(score);
    const isFlaky = score > 0 && score < 1.0;
    const recentResults = history.map(h => h.status);
    const resolvedSuiteId = suiteId ?? history[0]?.suiteId ?? '';

    return {
      caseName,
      suiteId: resolvedSuiteId,
      isFlaky,
      score,
      level,
      recentResults,
      suggestion: generateSuggestion(level, score, failCount, totalRuns),
      failCount,
      totalRuns,
    };
  }

  /**
   * Analyze all distinct test cases in a project for flakiness.
   * Supports filtering by minScore, topN, and suiteId.
   */
  analyzeAll(project: string, options?: { minScore?: number; topN?: number; suiteId?: string }): FlakyInfo[] {
    const minScore = options?.minScore ?? 0;
    const topN = options?.topN ?? 50;
    const suiteId = options?.suiteId;

    const caseNames = this.store.getDistinctCaseNames(project, { suiteId });
    const results: FlakyInfo[] = [];

    for (const caseName of caseNames) {
      const info = this.analyze(caseName, project, suiteId);
      if (info.score >= minScore) {
        results.push(info);
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }
}

function classifyStability(score: number): StabilityLevel {
  if (score === 0) return 'STABLE';
  if (score <= 0.2) return 'MOSTLY_STABLE';
  if (score <= 0.5) return 'FLAKY';
  if (score < 1.0) return 'VERY_FLAKY';
  return 'BROKEN';
}

function generateSuggestion(level: StabilityLevel, score: number, failCount: number, totalRuns: number): string {
  const pct = Math.round(score * 100);
  switch (level) {
    case 'STABLE':
      return 'Test is stable — all recent runs passed.';
    case 'MOSTLY_STABLE':
      return `Test is mostly stable with occasional failures (${pct}% failure rate, ${failCount}/${totalRuns} runs). Monitor for recurring patterns.`;
    case 'FLAKY':
      return `This test fails ${pct}% of the time (${failCount}/${totalRuns} runs). Consider adding retry logic or investigating timing-dependent assertions.`;
    case 'VERY_FLAKY':
      return `This test fails ${pct}% of the time (${failCount}/${totalRuns} runs). Immediate investigation recommended — check for race conditions, external dependencies, or environment issues.`;
    case 'BROKEN':
      return `Test has failed in all ${totalRuns} recent runs. This is likely a real bug, not flakiness. Fix the underlying issue.`;
  }
}
