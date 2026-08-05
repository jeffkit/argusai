/**
 * @module tools/analyze
 * argus_analyze — Inspect a project repo and produce an e2e.yaml draft.
 *
 * The tool is read-only by default (returns the report + suggested config
 * without touching disk). Pass `writeConfig: true` to materialize the draft
 * to `e2e.yaml` (or `configFile` if specified) for AI agents that want
 * "one shot and done" project onboarding.
 */

import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeProject, serializeConfig, type AnalysisReport } from 'argusai-core';
import { SessionError } from '../session.js';

export interface AnalyzeParams {
  projectPath: string;
  /** Project name override. Defaults to directory basename. */
  projectName?: string;
  /** When true, write the suggested config to disk. Default: false. */
  writeConfig?: boolean;
  /** Config filename (default: e2e.yaml). */
  configFile?: string;
  /** Overwrite existing config file. Default: false (refuses if file exists). */
  overwrite?: boolean;
}

export interface AnalyzeResult {
  report: AnalysisReport;
  /** Absolute path of the written config (only when writeConfig=true). */
  writtenTo?: string;
}

export async function handleAnalyze(params: AnalyzeParams): Promise<AnalyzeResult> {
  if (!params.projectPath || typeof params.projectPath !== 'string') {
    throw new SessionError('INVALID_INPUT', 'projectPath is required.');
  }

  const report = await analyzeProject({
    projectPath: params.projectPath,
    ...(params.projectName ? { projectName: params.projectName } : {}),
  });

  let writtenTo: string | undefined;
  if (params.writeConfig) {
    const filename = params.configFile ?? 'e2e.yaml';
    const fullPath = resolve(params.projectPath, filename);
    if (existsSync(fullPath) && !params.overwrite) {
      throw new SessionError(
        'CONFIG_EXISTS',
        `${filename} already exists at ${fullPath}. Pass overwrite=true to replace it.`,
      );
    }
    writeFileSync(fullPath, serializeConfig(report.suggestedConfig), 'utf-8');
    writtenTo = fullPath;
  }

  return {
    report,
    ...(writtenTo ? { writtenTo } : {}),
  };
}