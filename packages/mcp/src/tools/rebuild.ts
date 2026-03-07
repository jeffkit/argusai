/**
 * @module tools/rebuild
 * argus_rebuild — One-step rebuild: clean → init → build → setup.
 *
 * Convenience command for the most common development iteration cycle.
 */

import { loadConfig } from 'argusai-core';
import type { E2EConfig } from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';
import { handleClean } from './clean.js';
import { handleInit } from './init.js';
import { handleBuild, type BuildResult } from './build.js';
import { handleSetup, type SetupResult } from './setup.js';
import type { PlatformServices } from '../server.js';

export interface RebuildResult {
  steps: {
    clean: { success: boolean; error?: string };
    init: { success: boolean; error?: string };
    build: { success: boolean; result?: BuildResult; error?: string };
    setup: { success: boolean; result?: SetupResult; error?: string };
  };
  totalDuration: number;
}

export async function handleRebuild(
  params: { projectPath: string; noCache?: boolean; configFile?: string },
  sessionManager: SessionManager,
  platform?: PlatformServices,
): Promise<RebuildResult> {
  const totalStart = Date.now();
  const steps: RebuildResult['steps'] = {
    clean: { success: false },
    init: { success: false },
    build: { success: false },
    setup: { success: false },
  };

  // Step 1: Clean (ignore errors if no session exists)
  try {
    await handleClean({ projectPath: params.projectPath }, sessionManager);
    steps.clean = { success: true };
  } catch (err) {
    if (err instanceof SessionError && err.code === 'SESSION_NOT_FOUND') {
      steps.clean = { success: true };
    } else {
      steps.clean = { success: false, error: (err as Error).message };
    }
  }

  // Step 2: Init
  try {
    await handleInit({ projectPath: params.projectPath, configFile: params.configFile }, sessionManager);
    steps.init = { success: true };
  } catch (err) {
    steps.init = { success: false, error: (err as Error).message };
    return { steps, totalDuration: Date.now() - totalStart };
  }

  // Step 3: Build
  try {
    const buildResult = await handleBuild(
      { projectPath: params.projectPath, noCache: params.noCache },
      sessionManager,
      platform,
    );
    const anyFailed = buildResult.services.some(s => s.status === 'failed');
    steps.build = { success: !anyFailed, result: buildResult, error: anyFailed ? 'One or more services failed to build' : undefined };
    if (anyFailed) {
      return { steps, totalDuration: Date.now() - totalStart };
    }
  } catch (err) {
    steps.build = { success: false, error: (err as Error).message };
    return { steps, totalDuration: Date.now() - totalStart };
  }

  // Step 4: Setup
  try {
    const setupResult = await handleSetup({ projectPath: params.projectPath }, sessionManager);
    const allHealthy = setupResult.services.every(s => s.status !== 'failed' && s.status !== 'unhealthy');
    steps.setup = { success: allHealthy, result: setupResult, error: allHealthy ? undefined : 'Some services are unhealthy' };
  } catch (err) {
    steps.setup = { success: false, error: (err as Error).message };
  }

  return { steps, totalDuration: Date.now() - totalStart };
}
