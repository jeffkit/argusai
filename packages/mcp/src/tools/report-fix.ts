/**
 * @module tools/report-fix
 * argus_report_fix — Record a fix reported by an AI Agent and update the knowledge base.
 */

import type { SessionManager } from '../session.js';
import type { ReportFixResult, FailureEvent } from 'argusai-core';
import { createDefaultClassifier, DiagnosticsEngine } from 'argusai-core';

export interface ReportFixParams {
  projectPath: string;
  runId: string;
  caseName: string;
  fixDescription: string;
  success?: boolean;
}

export async function handleReportFix(
  params: ReportFixParams,
  sessionManager: SessionManager,
): Promise<ReportFixResult> {
  const session = await sessionManager.ensure(params.projectPath);

  if (!session.historyStore || !session.knowledgeStore) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('HISTORY_DISABLED', 'History/knowledge base is disabled in project configuration');
  }

  const runData = session.historyStore.getRunById(params.runId);
  if (!runData) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('RUN_NOT_FOUND', `Test run '${params.runId}' not found in history`);
  }

  const testCase = runData.cases.find((c) => c.caseName === params.caseName);
  if (!testCase) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('CASE_NOT_FOUND', `Case '${params.caseName}' not found in run '${params.runId}'`);
  }

  const event: FailureEvent = {
    runId: params.runId,
    caseName: testCase.caseName,
    suiteId: testCase.suiteId,
    error: testCase.error ?? '',
    status: null,
    containerStatus: null,
    oomKilled: false,
    diagnostics: null,
  };

  const statusMatch = testCase.error?.match(/\b([45]\d{2})\b/);
  if (statusMatch) {
    event.status = parseInt(statusMatch[1]!, 10);
  }

  const classifier = createDefaultClassifier();
  const engine = new DiagnosticsEngine(classifier, session.knowledgeStore);
  const success = params.success ?? true;

  return engine.reportFix(event, params.fixDescription, success);
}
