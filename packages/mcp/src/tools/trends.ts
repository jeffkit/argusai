/**
 * @module tools/trends
 * argus_trends — Retrieve trend data for specified metrics over time.
 */

import type { TrendDataPoint, TestRunRecord } from 'argusai-core';
import type { SessionManager } from '../session.js';

export interface TrendsParams {
  projectPath: string;
  metric: 'pass-rate' | 'duration' | 'flaky';
  days?: number;
  suiteId?: string;
}

export interface TrendsSummary {
  current: number;
  previous: number;
  change: number;
  direction: 'up' | 'down' | 'stable';
}

export interface TrendsResult {
  metric: 'pass-rate' | 'duration' | 'flaky';
  period: { from: string; to: string };
  dataPoints: TrendDataPoint[];
  summary: TrendsSummary;
}

export async function handleTrends(
  params: TrendsParams,
  sessionManager: SessionManager,
): Promise<TrendsResult> {
  const session = await sessionManager.ensure(params.projectPath);

  if (!session.historyStore) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('HISTORY_DISABLED', 'History is disabled in project configuration');
  }

  const days = Math.min(Math.max(params.days ?? 14, 1), 90);
  const now = Date.now();
  const fromMs = now - days * 24 * 60 * 60 * 1000;

  const runs = session.historyStore.getRunsInDateRange(
    session.config.project.name,
    fromMs,
    now,
  );

  const fromDate = new Date(fromMs).toISOString().slice(0, 10);
  const toDate = new Date(now).toISOString().slice(0, 10);

  const dataPoints = aggregateByDay(runs, params.metric);
  const summary = computeSummary(dataPoints);

  return {
    metric: params.metric,
    period: { from: fromDate, to: toDate },
    dataPoints,
    summary,
  };
}

function aggregateByDay(runs: TestRunRecord[], metric: 'pass-rate' | 'duration' | 'flaky'): TrendDataPoint[] {
  const dayMap = new Map<string, TestRunRecord[]>();

  for (const run of runs) {
    const date = new Date(run.timestamp).toISOString().slice(0, 10);
    const existing = dayMap.get(date) ?? [];
    existing.push(run);
    dayMap.set(date, existing);
  }

  const points: TrendDataPoint[] = [];
  const sortedDays = [...dayMap.keys()].sort();

  for (const date of sortedDays) {
    const dayRuns = dayMap.get(date)!;
    const runCount = dayRuns.length;

    let value: number;
    switch (metric) {
      case 'pass-rate': {
        const totalCases = dayRuns.reduce((s, r) => s + r.passed + r.failed + r.skipped, 0);
        const passedCases = dayRuns.reduce((s, r) => s + r.passed, 0);
        value = totalCases > 0 ? (passedCases / totalCases) * 100 : 0;
        break;
      }
      case 'duration': {
        const totalDuration = dayRuns.reduce((s, r) => s + r.duration, 0);
        value = totalDuration / runCount;
        break;
      }
      case 'flaky': {
        value = dayRuns.reduce((s, r) => s + r.flaky, 0);
        break;
      }
    }

    points.push({ date, value: Math.round(value * 100) / 100, runCount });
  }

  return points;
}

function computeSummary(dataPoints: TrendDataPoint[]): TrendsSummary {
  if (dataPoints.length === 0) {
    return { current: 0, previous: 0, change: 0, direction: 'stable' };
  }

  const current = dataPoints[dataPoints.length - 1]!.value;
  const previous = dataPoints.length > 1 ? dataPoints[dataPoints.length - 2]!.value : current;

  const change = previous !== 0
    ? Math.round(((current - previous) / previous) * 100 * 10) / 10
    : 0;

  const direction: 'up' | 'down' | 'stable' =
    change > 0 ? 'up' : change < 0 ? 'down' : 'stable';

  return { current, previous, change, direction };
}
