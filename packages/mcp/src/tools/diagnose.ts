/**
 * @module tools/diagnose
 * argus_diagnose — Perform full diagnostic workflow on a failed test case.
 */

import type { SessionManager } from '../session.js';
import type { DiagnosticResult } from 'argusai-core';
import { createDefaultClassifier, DiagnosticsEngine } from 'argusai-core';
import type { FailureEvent } from 'argusai-core';

export interface DiagnoseParams {
  projectPath: string;
  runId: string;
  caseName: string;
}

export async function handleDiagnose(
  params: DiagnoseParams,
  sessionManager: SessionManager,
): Promise<DiagnosticResult> {
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

  if (testCase.status !== 'failed') {
    const { SessionError } = await import('../session.js');
    throw new SessionError('CASE_NOT_FAILED', `Case '${params.caseName}' did not fail (status: ${testCase.status})`);
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

  // Extract HTTP status from error string if present
  const statusMatch = testCase.error?.match(/\b([45]\d{2})\b/);
  if (statusMatch) {
    event.status = parseInt(statusMatch[1]!, 10);
  }

  const classifier = createDefaultClassifier();
  const engine = new DiagnosticsEngine(classifier, session.knowledgeStore);

  return engine.diagnose(event);
}
