/**
 * @module server
 * MCP server setup — registers all 23 tools with Zod input schemas.
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
import { handleDev } from './tools/dev.js';

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
  /**
   * Current session lifecycle state for the project, or "none" when no session
   * exists. Included in every response so AI agents can track environment state
   * without needing a separate argus_status call.
   *
   * Values: "initialized" | "built" | "running" | "stopped" | "none"
   */
  sessionState?: string;
  /** Non-fatal issues encountered during the operation (e.g. history write failures). */
  warnings?: string[];
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

/**
 * Wrap tool result data in a success envelope that includes the current
 * session state. Use this for lifecycle tools (init/build/setup/run/clean)
 * so AI agents always know what phase the project is in.
 */
function successResponseWithState<T>(
  data: T,
  sessionManager: SessionManager,
  projectPath: string,
  warnings?: string[],
  options?: { isError?: boolean },
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const sessionState = sessionManager.has(projectPath)
    ? sessionManager.getOrThrow(projectPath).state
    : 'none';
  const envelope: McpToolResponse<T> = {
    success: true,
    data,
    sessionState,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
    timestamp: Date.now(),
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
    ...(options?.isError ? { isError: true } : {}),
  };
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
 * Resolve the effective project path for a tool call.
 *
 * Resolution order:
 *   1. Explicit `projectPath` from the tool parameters (absolute path required)
 *   2. `ARGUS_PROJECT_PATH` environment variable (set once at server startup)
 *
 * NOTE: process.cwd() is intentionally NOT used as a fallback. Silently
 * running tests in the wrong directory causes hard-to-debug failures,
 * especially for AI agents that may be invoked from arbitrary working dirs.
 *
 * @throws {SessionError} PROJECT_PATH_REQUIRED when neither source provides a path.
 */
function resolveProjectPath(projectPath?: string): string {
  const resolved = projectPath?.trim() || process.env['ARGUS_PROJECT_PATH']?.trim();
  if (!resolved) {
    throw new SessionError(
      'PROJECT_PATH_REQUIRED',
      'projectPath is required. Pass it as a tool parameter or set the ARGUS_PROJECT_PATH environment variable. ' +
      'Do not rely on the current working directory — it may differ from the project root.',
    );
  }
  return resolved;
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

  // =====================================================================
  // [lifecycle] Core workflow: init → build → setup → run → clean
  // =====================================================================

  // Tool 1: argus_init
  server.tool(
    'argus_init',
    {
      projectPath: z.string().optional().describe(
        '[lifecycle] Absolute path to project directory containing e2e.yaml. STEP 1 of 5: loads config and creates a session. ' +
        'Optional when ARGUS_PROJECT_PATH env var is set.',
      ),
      configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
    },
    async (params) => {
      try {
        const projectPath = resolveProjectPath(params.projectPath);
        const result = await handleInit({ ...params, projectPath }, sessionManager);
        return successResponseWithState(result, sessionManager, projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 2: argus_build
  server.tool(
    'argus_build',
    {
      projectPath: z.string().optional().describe('[lifecycle] Project path (must have active session from argus_init). STEP 2 of 5: builds Docker image(s). Optional when ARGUS_PROJECT_PATH is set.'),
      noCache: z.boolean().optional().describe('Disable Docker layer cache'),
      service: z.string().optional().describe('Build specific service (multi-service mode)'),
      useExisting: z.boolean().optional().describe('Skip build if image already exists locally'),
    },
    async (params) => {
      try {
        const projectPath = resolveProjectPath(params.projectPath);
        const result = await handleBuild({ ...params, projectPath }, sessionManager, platform);
        return successResponseWithState(result, sessionManager, projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 3: argus_setup
  server.tool(
    'argus_setup',
    {
      projectPath: z.string().optional().describe('[lifecycle] Project path (must have built images). STEP 3 of 5: starts network, mocks, and containers. Optional when ARGUS_PROJECT_PATH is set.'),
      timeout: z.string().optional().describe('Health check timeout override, e.g. "120s"'),
    },
    async (params) => {
      try {
        const projectPath = resolveProjectPath(params.projectPath);
        const result = await handleSetup({ ...params, projectPath }, sessionManager);
        return successResponseWithState(result, sessionManager, projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 4: argus_run
  server.tool(
    'argus_run',
    {
      projectPath: z.string().optional().describe('[lifecycle] Project path. STEP 4 of 5: executes all or filtered test suites. Auto-starts missing service/mock containers via setup when needed. Optional when ARGUS_PROJECT_PATH is set.'),
      filter: z.string().optional().describe('Suite ID filter (comma-separated for multiple)'),
      parallel: z.boolean().optional().describe('Override parallel execution setting'),
      maxFailures: z.number().optional().default(20).describe(
        'Max failed cases to include in response (default: 20). Prevents context overflow in large suites. ' +
        'Passed cases are always summarised by count only. Use argus_diagnose for full failure details.',
      ),
    },
    async (params) => {
      try {
        const projectPath = resolveProjectPath(params.projectPath);
        const result = await handleRun({ ...params, projectPath }, sessionManager, formatter, platform);
        // Issue #6: mark tool result as error when tests failed so MCP clients /
        // CI wrappers can treat non-green runs as failures (exitCode also in payload).
        return successResponseWithState(
          result,
          sessionManager,
          projectPath,
          result.warnings,
          { isError: result.status === 'failed' },
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 5: argus_run_suite
  server.tool(
    'argus_run_suite',
    {
      projectPath: z.string().optional().describe('[lifecycle] Project path. Runs a single named suite with full per-step output — prefer argus_run for batch execution, use this for focused debugging. Optional when ARGUS_PROJECT_PATH is set.'),
      suiteId: z.string().describe('Suite identifier to run'),
      maxFailures: z.number().optional().default(20).describe('Max failed cases to include in response (default: 20).'),
    },
    async (params) => {
      try {
        const projectPath = resolveProjectPath(params.projectPath);
        const result = await handleRunSuite({ ...params, projectPath }, sessionManager, formatter, platform);
        return successResponseWithState(
          result,
          sessionManager,
          projectPath,
          result.warnings,
          { isError: result.status === 'failed' },
        );
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 6: argus_status
  server.tool(
    'argus_status',
    {
      projectPath: z.string().describe('[lifecycle] Project path. Shows current container/network/session status. Check sessionState in any response first — only call this for detailed per-container info.'),
    },
    async (params) => {
      try {
        const result = await handleStatus(params, sessionManager);
        return successResponseWithState(result, sessionManager, params.projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 7: argus_logs
  server.tool(
    'argus_logs',
    {
      projectPath: z.string().describe('[lifecycle] Project path. Streams recent container log lines — useful for debugging setup failures.'),
      container: z.string().describe('Container name'),
      lines: z.number().optional().describe('Number of tail lines (default: 100)'),
      since: z.string().optional().describe('Show logs since timestamp, e.g. "5m", "2h"'),
    },
    async (params) => {
      try {
        const result = await handleLogs(params, sessionManager);
        return successResponseWithState(result, sessionManager, params.projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 8: argus_clean
  server.tool(
    'argus_clean',
    {
      projectPath: z.string().optional().describe('[lifecycle] Project path. STEP 5 of 5: stops containers, removes network, and destroys session. Optional when ARGUS_PROJECT_PATH is set.'),
      force: z.boolean().optional().describe('Force remove stuck containers'),
    },
    async (params) => {
      try {
        const projectPath = resolveProjectPath(params.projectPath);
        const result = await handleClean({ ...params, projectPath }, sessionManager);
        // After clean, session is removed — state will be "none"
        return successResponseWithState(result, sessionManager, projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // =====================================================================
  // [mock] Mock server tools
  // =====================================================================

  // Tool 9: argus_mock_requests
  server.tool(
    'argus_mock_requests',
    {
      projectPath: z.string().describe('[mock] Project path. Lists captured HTTP requests received by mock servers — use to verify service integration.'),
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

  // =====================================================================
  // [diagnostic] Environment health & resilience tools
  // =====================================================================

  // Tool 10: argus_preflight_check
  server.tool(
    'argus_preflight_check',
    {
      projectPath: z.string().describe('[diagnostic] Project path. Checks Docker daemon, disk space, and orphaned resources before setup.'),
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
      projectPath: z.string().describe('[diagnostic] Project path. Resets the circuit-breaker after consecutive Docker errors — call when setup is blocked by a tripped breaker.'),
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

  // =====================================================================
  // [history] Historical run data — requires history.enabled in e2e.yaml
  // =====================================================================

  // Tool 12: argus_history
  server.tool(
    'argus_history',
    {
      projectPath: z.string().describe('[history] Project path. Returns paginated list of past test runs with pass/fail counts.'),
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
      projectPath: z.string().describe('[history] Project path. Computes pass-rate / duration / flaky trend over time for charts or summaries.'),
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
      projectPath: z.string().describe('[history] Project path. Ranks test cases by flakiness score — highest scores indicate non-deterministic tests that need attention.'),
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
      projectPath: z.string().describe('[history] Project path. Diffs two run IDs to show regressions and fixes between them.'),
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

  // =====================================================================
  // [knowledge] AI-assisted failure diagnosis and fix feedback
  // =====================================================================

  // Tool 16: argus_diagnose (knowledge base: classify + match + suggest)
  server.tool(
    'argus_diagnose',
    {
      projectPath: z.string().describe('[knowledge] Project path. Classifies a failure, matches known patterns, and returns ranked fix suggestions — call immediately after a test run fails.'),
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
      projectPath: z.string().describe('[knowledge] Project path. Records whether a fix resolved a failure, increasing pattern confidence scores for future diagnoses.'),
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
      projectPath: z.string().describe('[knowledge] Project path. Lists built-in and learned failure patterns — use to understand what kinds of failures argus_diagnose can recognize.'),
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

  // =====================================================================
  // [mock] Mock generation tools (OpenAPI → YAML mock config)
  // =====================================================================

  // Tool 19: argus_mock_generate
  server.tool(
    'argus_mock_generate',
    {
      projectPath: z.string().describe('[mock] Absolute path to project directory. Generates an e2e.yaml mock block from an OpenAPI spec — run once to bootstrap mock config.'),
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
      projectPath: z.string().describe('[mock] Absolute path to project directory. Validates that mock routes match the referenced OpenAPI spec and flags missing or mismatched routes.'),
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

  // =====================================================================
  // [diagnostic] Global resource inspection (no session required)
  // =====================================================================

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

  // =====================================================================
  // [lifecycle] Compound convenience tools
  // =====================================================================

  // Tool 22: argus_rebuild (convenience: clean → init → build → setup)
  server.tool(
    'argus_rebuild',
    {
      projectPath: z.string().describe('[lifecycle] Absolute path to project directory. Shortcut that chains argus_clean → argus_init → argus_build → argus_setup in one call.'),
      noCache: z.boolean().optional().describe('Disable Docker layer cache for rebuild'),
      configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
    },
    async (params) => {
      try {
        const result = await handleRebuild(params, sessionManager, platform);
        return successResponseWithState(result, sessionManager, params.projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // Tool 23: argus_dev (one-step start for manual testing)
  server.tool(
    'argus_dev',
    {
      projectPath: z.string().describe('[lifecycle] Absolute path to project directory. Full one-step startup: init → build → setup — best for first-time project onboarding.'),
      configFile: z.string().optional().describe('Config filename override (default: e2e.yaml)'),
      noCache: z.boolean().optional().describe('Disable Docker layer cache for build'),
      skipBuild: z.boolean().optional().describe('Skip Docker build (reuse existing image)'),
    },
    async (params) => {
      try {
        const result = await handleDev(params, sessionManager, platform);
        return successResponseWithState(result, sessionManager, params.projectPath);
      } catch (err) {
        return handleError(err);
      }
    },
  );

  return { server, sessionManager, formatter, platform };
}
