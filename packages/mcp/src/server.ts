/**
 * @module server
 * MCP server setup — registers all 21 tools with Zod input schemas.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SSEBus, Store, TaskQueue, Notifier, ResourceLimiter } from 'argusai-core';
import { ArgusError } from 'argusai-core';
import { SessionManager, SessionError } from './session.js';
import { ResultFormatter } from './formatters/result-formatter.js';
import { handleInit } from './tools/init.js';
import { handleBuild } from './tools/build.js';
import { handleSetup } from './tools/setup.js';
import { handleRun, handleRunSuite } from './tools/run.js';
import { handleStatus } from './tools/status.js';
import { handleLogs } from './tools/logs.js';
import { handleClean } from './tools/clean.js';
import { handleMockRequests } from './tools/mock-requests.js';
import { handlePreflightCheck } from './tools/preflight-check.js';
import { handleResetCircuit } from './tools/reset-circuit.js';
import { handleHistory } from './tools/history.js';
import { handleTrends } from './tools/trends.js';
import { handleFlaky } from './tools/flaky.js';
import { handleCompare } from './tools/compare.js';
import { handleDiagnose } from './tools/diagnose.js';
import { handleReportFix } from './tools/report-fix.js';
import { handlePatterns } from './tools/patterns.js';
import { handleMockGenerate } from './tools/mock-generate.js';
import { handleMockValidate } from './tools/mock-validate.js';
import { handleResources } from './tools/resources.js';
import { handleRebuild } from './tools/rebuild.js';

/** Shared platform services injected into tool handlers. */
export interface PlatformServices {
  store?: Store;
  taskQueue?: TaskQueue;
  notifier?: Notifier;
  resourceLimiter?: ResourceLimiter;
}

/** Options for creating the MCP server with shared dependencies. */
export interface CreateServerOptions {
  sessionManager?: SessionManager;
  eventBus?: SSEBus;
  platform?: PlatformServices;
}

interface McpToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  timestamp: number;
}

/** Wrap tool result data in a success JSON envelope. */
function successResponse<T>(data: T): { content: Array<{ type: 'text'; text: string }> } {
  const envelope: McpToolResponse<T> = {
    success: true,
    data,
    timestamp: Date.now(),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }] };
}

/** Wrap an error in a structured JSON envelope with code and message. */
function errorResponse(code: string, message: string, details?: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const envelope: McpToolResponse = {
    success: false,
    error: { code, message, details },
    timestamp: Date.now(),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }] };
}

/** Convert an unknown thrown value into an MCP error response. */
function handleError(err: unknown): { content: Array<{ type: 'text'; text: string }> } {
  if (err instanceof ArgusError) {
    return errorResponse(err.code, err.message, err.toJSON());
  }
  if (err instanceof SessionError) {
    return errorResponse(err.code, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse('INTERNAL_ERROR', message);
}

/**
 * Create and configure the MCP server with all 20 tools registered.
 *
 * When called without options, creates standalone instances.
 * Pass shared `sessionManager` and `eventBus` to integrate with Dashboard.
 */
export function createServer(options?: CreateServerOptions): {
  server: McpServer;
  sessionManager: SessionManager;
  formatter: ResultFormatter;
  platform: PlatformServices;
} {
  const server = new McpServer({
    name: 'argusai-mcp',
    version: '0.1.0',
  });

  const sessionManager = options?.sessionManager ?? new SessionManager(options?.eventBus);
  if (options?.eventBus && !sessionManager.eventBus) {
    sessionManager.eventBus = options.eventBus;
  }
  const formatter = new ResultFormatter();
  const platform = options?.platform ?? {};

  // Tool 1: argus_init
  server.tool(
    'argus_init',
    {
      projectPath: z.string().describe('Absolute path to project directory containing e2e.yaml'),
      configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
    },
    async (params) => {
      try {
        const result = await handleInit(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 2: argus_build
  server.tool(
    'argus_build',
    {
      projectPath: z.string().describe('Project path (must have active session)'),
      noCache: z.boolean().optional().describe('Disable Docker layer cache'),
      service: z.string().optional().describe('Build specific service (multi-service mode)'),
      useExisting: z.boolean().optional().describe('Skip build if image already exists locally'),
    },
    async (params) => {
      try {
        const result = await handleBuild(params, sessionManager, platform);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 3: argus_setup
  server.tool(
    'argus_setup',
    {
      projectPath: z.string().describe('Project path (must have built images)'),
      timeout: z.string().optional().describe('Health check timeout override, e.g. "120s"'),
    },
    async (params) => {
      try {
        const result = await handleSetup(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 4: argus_run
  server.tool(
    'argus_run',
    {
      projectPath: z.string().describe('Project path (must have running environment)'),
      filter: z.string().optional().describe('Suite ID filter (comma-separated for multiple)'),
      parallel: z.boolean().optional().describe('Override parallel execution setting'),
    },
    async (params) => {
      try {
        const result = await handleRun(params, sessionManager, formatter, platform);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 5: argus_run_suite
  server.tool(
    'argus_run_suite',
    {
      projectPath: z.string().describe('Project path'),
      suiteId: z.string().describe('Suite identifier to run'),
    },
    async (params) => {
      try {
        const result = await handleRunSuite(params, sessionManager, formatter, platform);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 6: argus_status
  server.tool(
    'argus_status',
    {
      projectPath: z.string().describe('Project path'),
    },
    async (params) => {
      try {
        const result = await handleStatus(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 7: argus_logs
  server.tool(
    'argus_logs',
    {
      projectPath: z.string().describe('Project path'),
      container: z.string().describe('Container name'),
      lines: z.number().optional().describe('Number of tail lines (default: 100)'),
      since: z.string().optional().describe('Show logs since timestamp, e.g. "5m", "2h"'),
    },
    async (params) => {
      try {
        const result = await handleLogs(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 8: argus_clean
  server.tool(
    'argus_clean',
    {
      projectPath: z.string().describe('Project path'),
      force: z.boolean().optional().describe('Force remove stuck containers'),
    },
    async (params) => {
      try {
        const result = await handleClean(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 9: argus_mock_requests
  server.tool(
    'argus_mock_requests',
    {
      projectPath: z.string().describe('Project path'),
      mockName: z.string().optional().describe('Specific mock name (default: all mocks)'),
      since: z.string().optional().describe('Filter requests after timestamp'),
      clear: z.boolean().optional().describe('Clear request log after reading'),
    },
    async (params) => {
      try {
        const result = await handleMockRequests(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 10: argus_preflight_check
  server.tool(
    'argus_preflight_check',
    {
      projectPath: z.string().describe('Project path (must have active session)'),
      skipDiskCheck: z.boolean().optional().describe('Skip disk space check'),
      skipOrphanCheck: z.boolean().optional().describe('Skip orphaned resource check'),
      autoFix: z.boolean().optional().describe('Auto-clean orphaned resources'),
    },
    async (params) => {
      try {
        const result = await handlePreflightCheck(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 11: argus_reset_circuit
  server.tool(
    'argus_reset_circuit',
    {
      projectPath: z.string().describe('Project path (must have active session)'),
    },
    async (params) => {
      try {
        const result = await handleResetCircuit(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 12: argus_history
  server.tool(
    'argus_history',
    {
      projectPath: z.string().describe('Project path (must have active session)'),
      limit: z.number().optional().default(20).describe('Max number of runs to return (1-100)'),
      status: z.enum(['passed', 'failed']).optional().describe('Filter by run status'),
      days: z.number().optional().describe('Filter to runs within the last N days'),
      offset: z.number().optional().default(0).describe('Pagination offset'),
    },
    async (params) => {
      try {
        const result = await handleHistory(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 13: argus_trends
  server.tool(
    'argus_trends',
    {
      projectPath: z.string().describe('Project path'),
      metric: z.enum(['pass-rate', 'duration', 'flaky']).describe('Metric to trend'),
      days: z.number().optional().default(14).describe('Number of days to analyze (1-90)'),
      suiteId: z.string().optional().describe('Filter to a specific suite'),
    },
    async (params) => {
      try {
        const result = await handleTrends(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 14: argus_flaky
  server.tool(
    'argus_flaky',
    {
      projectPath: z.string().describe('Project path'),
      topN: z.number().optional().default(10).describe('Number of flaky cases to return (1-50)'),
      minScore: z.number().optional().default(0.01).describe('Minimum flaky score threshold (0-1)'),
      suiteId: z.string().optional().describe('Filter to a specific suite'),
    },
    async (params) => {
      try {
        const result = await handleFlaky(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 15: argus_compare
  server.tool(
    'argus_compare',
    {
      projectPath: z.string().describe('Project path'),
      baseRunId: z.string().describe('ID of the base (earlier) run'),
      compareRunId: z.string().describe('ID of the comparison (later) run'),
    },
    async (params) => {
      try {
        const result = await handleCompare(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 16: argus_diagnose (knowledge base: classify + match + suggest)
  server.tool(
    'argus_diagnose',
    {
      projectPath: z.string().describe('Project path (must have active session with history enabled)'),
      runId: z.string().describe('ID of the test run containing the failed case'),
      caseName: z.string().describe('Name of the failed test case to diagnose'),
    },
    async (params) => {
      try {
        const result = await handleDiagnose(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 17: argus_report_fix (knowledge base: record fix + update confidence)
  server.tool(
    'argus_report_fix',
    {
      projectPath: z.string().describe('Project path (must have active session with history enabled)'),
      runId: z.string().describe('ID of the test run where the failure was originally diagnosed'),
      caseName: z.string().describe('Name of the test case that was fixed'),
      fixDescription: z.string().describe('Description of what was changed to fix the failure'),
      success: z.boolean().optional().default(true).describe('Whether the fix resolved the failure (default: true)'),
    },
    async (params) => {
      try {
        const result = await handleReportFix(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 18: argus_patterns (knowledge base: browse failure patterns)
  server.tool(
    'argus_patterns',
    {
      projectPath: z.string().describe('Project path (must have active session with history enabled)'),
      category: z.enum([
        'ASSERTION_MISMATCH', 'HTTP_ERROR', 'TIMEOUT', 'CONNECTION_REFUSED',
        'CONTAINER_OOM', 'CONTAINER_CRASH', 'MOCK_MISMATCH', 'CONFIG_ERROR',
        'NETWORK_ERROR', 'UNKNOWN',
      ]).optional().describe('Filter patterns by failure category'),
      source: z.enum(['built-in', 'learned']).optional().describe('Filter by pattern source'),
      sortBy: z.enum(['confidence', 'occurrences', 'lastSeen']).optional().default('occurrences')
        .describe('Sort order for results'),
    },
    async (params) => {
      try {
        const result = await handlePatterns(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 19: argus_mock_generate
  server.tool(
    'argus_mock_generate',
    {
      projectPath: z.string().describe('Absolute path to project directory containing e2e.yaml'),
      specPath: z.string().describe('Path to OpenAPI 3.x spec file (YAML or JSON). Absolute or relative to projectPath.'),
      mockName: z.string().optional().describe('Name for the generated mock service. Default: derived from spec title.'),
      port: z.number().optional().describe('Port number for the mock server. Default: 9090.'),
      mode: z.enum(['auto', 'record', 'replay', 'smart']).optional().describe('Mock operating mode. Default: auto.'),
      validate: z.boolean().optional().describe('Enable request validation in generated config. Default: false.'),
      target: z.string().optional().describe('Real API base URL (required when mode is "record").'),
    },
    async (params) => {
      try {
        const result = await handleMockGenerate(params);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 20: argus_mock_validate
  server.tool(
    'argus_mock_validate',
    {
      projectPath: z.string().describe('Absolute path to project directory containing e2e.yaml'),
      mockName: z.string().optional().describe('Name of the mock service to validate. If omitted, validates all mocks with openapi field.'),
      specPath: z.string().optional().describe('Override: path to OpenAPI spec file. If omitted, uses the openapi field from mock config.'),
    },
    async (params) => {
      try {
        const result = await handleMockValidate(params, sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 21: argus_resources (multi-project isolation — list all managed Docker resources)
  server.tool(
    'argus_resources',
    {},
    async () => {
      try {
        const result = await handleResources(sessionManager);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 22: argus_rebuild (convenience: clean → init → build → setup)
  server.tool(
    'argus_rebuild',
    {
      projectPath: z.string().describe('Absolute path to project directory containing e2e.yaml'),
      noCache: z.boolean().optional().describe('Disable Docker layer cache for rebuild'),
      configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
    },
    async (params) => {
      try {
        const result = await handleRebuild(params, sessionManager, platform);
        return successResponse(result);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  return { server, sessionManager, formatter, platform };
}
