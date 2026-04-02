#!/usr/bin/env node
/**
 * @module argusai
 * CLI entry point for ArgusAI.
 *
 * Registers all sub-commands and parses process.argv via Commander.js.
 */

import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerSetup } from './commands/setup.js';
import { registerRun } from './commands/run.js';
import { registerBuild } from './commands/build.js';
import { registerStatus } from './commands/status.js';
import { registerClean } from './commands/clean.js';
import { registerDashboard } from './commands/dashboard.js';
import { registerLogs } from './commands/logs.js';
import { registerMcpServer } from './commands/mcp-server.js';
import { registerServer } from './commands/server.js';
import { registerHistory } from './commands/history.js';
import { registerFlaky } from './commands/flaky.js';
import { registerDiagnose } from './commands/diagnose.js';
import { registerTrends } from './commands/trends.js';
import { registerCompare } from './commands/compare.js';
import { registerPatterns } from './commands/patterns.js';
import { registerDev } from './commands/dev.js';
import { registerRebuild } from './commands/rebuild.js';
import { registerResources } from './commands/resources.js';
import { registerPreflight } from './commands/preflight.js';
import { registerMockRequests } from './commands/mock-requests.js';
import { registerMockGenerate } from './commands/mock-generate.js';
import { registerMockValidate } from './commands/mock-validate.js';
import { registerReportFix } from './commands/report-fix.js';
import { registerResetCircuit } from './commands/reset-circuit.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('argusai')
    .description('配置驱动的 Docker 容器端到端测试平台')
    .version('0.1.0')
    .option('-c, --config <path>', 'e2e.yaml 配置文件路径')
    .option('--verbose', '启用详细输出');

  // Register sub-commands
  registerInit(program);
  registerSetup(program);
  registerRun(program);
  registerBuild(program);
  registerStatus(program);
  registerClean(program);
  registerDashboard(program);
  registerLogs(program);
  registerMcpServer(program);
  registerServer(program);
  registerHistory(program);
  registerFlaky(program);
  registerDiagnose(program);
  registerTrends(program);
  registerCompare(program);
  registerPatterns(program);
  registerDev(program);
  registerRebuild(program);
  registerResources(program);
  registerPreflight(program);
  registerMockRequests(program);
  registerMockGenerate(program);
  registerMockValidate(program);
  registerReportFix(program);
  registerResetCircuit(program);

  return program;
}

// Run when executed directly
const program = createProgram();
program.parse();
