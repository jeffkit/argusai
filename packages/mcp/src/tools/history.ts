/**
 * @module tools/history
 * argus_history — Query historical test run records for a project.
 */

import type { SessionManager } from '../session.js';

export interface HistoryParams {
  projectPath: string;
  limit?: number;
  status?: 'passed' | 'failed';
  days?: number;
  offset?: number;
}

export interface HistoryResult {
  runs: import('argusai-core').TestRunRecord[];
  total: number;
  hasMore: boolean;
}

export async function handleHistory(
  params: HistoryParams,
  sessionManager: SessionManager,
): Promise<HistoryResult> {
  const session = await sessionManager.ensure(params.projectPath);

  if (!session.historyStore) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('HISTORY_DISABLED', 'History is disabled in project configuration');
  }

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = params.offset ?? 0;

  const { runs, total } = session.historyStore.getRuns(
    session.config.project.name,
    {
      limit,
      offset,
      status: params.status,
      days: params.days,
    },
  );

  return {
    runs,
    total,
    hasMore: offset + runs.length < total,
  };
}
