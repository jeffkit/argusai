/**
 * @module tools/flaky
 * argus_flaky — List the flakiest test cases for a project.
 */

import { FlakyDetector } from 'argusai-core';
import type { FlakyInfo, HistoryConfig } from 'argusai-core';
import type { SessionManager } from '../session.js';

export interface FlakyParams {
  projectPath: string;
  topN?: number;
  minScore?: number;
  suiteId?: string;
  /**
   * Override the sliding-window size for flakiness scoring.
   * Defaults to `history.flakyWindow` from e2e.yaml (10).
   * Smaller window = recent-biased; larger = more statistical confidence.
   */
  window?: number;
}

export interface FlakyResult {
  cases: FlakyInfo[];
  totalFlaky: number;
  analysisWindow: number;
}

export async function handleFlaky(
  params: FlakyParams,
  sessionManager: SessionManager,
): Promise<FlakyResult> {
  const session = await sessionManager.ensure(params.projectPath);

  if (!session.historyStore) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('HISTORY_DISABLED', 'History is disabled in project configuration');
  }

  const topN = Math.min(Math.max(params.topN ?? 10, 1), 50);
  const minScore = params.minScore ?? 0.01;

  const historyConfig = session.config.history as HistoryConfig | undefined;
  const yamlWindow = historyConfig?.flakyWindow ?? 10;
  const flakyWindow = params.window !== undefined
    ? Math.min(Math.max(params.window, 1), 1000)
    : yamlWindow;

  const detector = new FlakyDetector(session.historyStore, flakyWindow);

  const cases = detector.analyzeAll(session.config.project.name, {
    topN,
    minScore,
    suiteId: params.suiteId,
  });

  return {
    cases,
    totalFlaky: cases.filter(c => c.isFlaky).length,
    analysisWindow: flakyWindow,
  };
}
