/**
 * @module config-loader
 * Configuration loader for preflight.
 *
 * Loads `e2e.yaml` configuration files, validates them with Zod schemas,
 * supports `.env` file loading and `{{variable}}` substitution.
 */

import { z } from 'zod';
import yaml from 'js-yaml';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import type { E2EConfig } from './types.js';
import { resolveObjectVariables } from './variable-resolver.js';

// =====================================================================
// Zod Sub-Schemas
// =====================================================================

/** Healthcheck configuration schema */
export const HealthcheckSchema = z.object({
  path: z.string().describe('HTTP health check endpoint path'),
  port: z.number().optional().describe('Container-internal port for health check (auto-detected from container ports if omitted)'),
  interval: z.string().default('10s').describe('Interval between health checks (e.g. "10s")'),
  timeout: z.string().default('5s').describe('Timeout per health check attempt (e.g. "5s")'),
  retries: z.number().default(10).describe('Number of consecutive failures before marking unhealthy'),
  startPeriod: z.string().default('30s').describe('Grace period before health checks start (e.g. "30s")'),
}).describe('Container health check configuration');

/** Service build configuration schema */
export const ServiceBuildSchema = z.object({
  dockerfile: z.string().describe('Path to the Dockerfile (relative to context)'),
  context: z.string().default('.').describe('Docker build context directory'),
  image: z.string().describe('Docker image name and tag (supports {{variable}} substitution)'),
  args: z.record(z.string()).optional().describe('Docker build-time arguments (--build-arg)'),
}).describe('Docker image build configuration');

/** Service container configuration schema */
export const ServiceContainerSchema = z.object({
  name: z.string().describe('Docker container name'),
  ports: z.array(z.string()).describe('Port mappings in "hostPort:containerPort" format'),
  environment: z.record(z.string()).optional().describe('Environment variables passed to the container'),
  volumes: z.array(z.string()).optional().describe('Volume mounts in "host:container" format'),
  healthcheck: HealthcheckSchema.optional().describe('Container health check configuration'),
}).describe('Docker container runtime configuration');

/** Mock route configuration schema */
export const MockRouteSchema = z.object({
  method: z.string().describe('HTTP method (GET, POST, PUT, DELETE, etc.)'),
  path: z.string().describe('Route path pattern (supports Express-style params like :id)'),
  response: z.object({
    status: z.number().default(200).describe('HTTP response status code'),
    headers: z.record(z.string()).optional().describe('Response headers'),
    body: z.unknown().describe('Response body (JSON object, string, or template)'),
    delay: z.string().optional().describe('Simulated response delay (e.g. "100ms", "2s")'),
  }).describe('Mock response definition'),
  when: z.object({
    body: z.record(z.unknown()).optional().describe('Match request body fields'),
    headers: z.record(z.string()).optional().describe('Match request headers'),
    query: z.record(z.string()).optional().describe('Match query parameters'),
  }).optional().describe('Conditional matching rules for request routing'),
}).describe('Mock service route definition');

/** Mock operating mode schema */
export const MockModeSchema = z.enum(['auto', 'record', 'replay', 'smart']);

/** Mock service configuration schema */
export const MockServiceSchema = z.object({
  port: z.number().describe('Host port the mock server listens on'),
  containerPort: z.number().optional().describe('Container-internal port (for Docker network access)'),
  routes: z.array(MockRouteSchema).optional()
    .describe('Mock route definitions (backward compatible; acts as overrides when openapi is set)'),
  image: z.string().optional().describe('Pre-built Docker image (alternative to inline routes)'),
  openapi: z.string().optional()
    .describe('Path to OpenAPI 3.x spec file (YAML or JSON), relative to e2e.yaml'),
  mode: MockModeSchema.optional().default('auto')
    .describe('Mock operating mode: auto, record, replay, smart'),
  validate: z.boolean().optional().default(false)
    .describe('Enable request validation against OpenAPI spec'),
  target: z.string().url().optional()
    .describe('Real API base URL for record mode proxying'),
  recordingsDir: z.string().optional().default('.argusai/recordings')
    .describe('Directory for storing recorded request/response pairs'),
  maxDepth: z.number().min(1).max(10).optional().default(3)
    .describe('Maximum nesting depth for circular $ref resolution'),
  overrides: z.array(MockRouteSchema).optional()
    .describe('Manual override routes that take precedence over auto-generated routes'),
}).refine(
  (data) => data.mode !== 'record' || data.target !== undefined,
  { message: 'target is required when mode is "record"', path: ['target'] },
).describe('Mock service configuration');

/** Retry policy schema */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().min(1).max(10).describe('Maximum retry attempts including first try'),
  delay: z.string().describe('Delay between retries, e.g. "2s", "500ms"'),
  backoff: z.enum(['linear', 'exponential']).optional().describe('Backoff strategy'),
  backoffMultiplier: z.number().optional().default(2).describe('Multiplier for exponential backoff'),
}).describe('Retry policy for transient test failures');

/** Parallel execution configuration schema */
export const ParallelConfigSchema = z.object({
  enabled: z.boolean().describe('Enable parallel suite execution'),
  concurrency: z.number().optional().describe('Max concurrent suites'),
}).describe('Parallel test execution configuration');

/** Service definition schema for multi-service orchestration */
export const ServiceDefinitionSchema = z.object({
  name: z.string().describe('Unique service identifier'),
  build: ServiceBuildSchema,
  container: ServiceContainerSchema,
  vars: z.record(z.string()).optional(),
  dependsOn: z.array(z.string()).optional().describe('Services that must be healthy before this one starts'),
}).describe('Service definition for multi-service orchestration');

/** Test suite configuration schema */
export const TestSuiteSchema = z.object({
  name: z.string().describe('Human-readable suite name'),
  id: z.string().describe('Unique suite identifier (used for filtering and reporting)'),
  file: z.string().optional().describe('Path to the test file (relative to e2e.yaml directory)'),
  runner: z.string().optional().describe('Test runner type: yaml, vitest, pytest, shell, exec, or playwright'),
  command: z.string().optional().describe('Custom command to execute (for exec runner)'),
  config: z.string().optional().describe('Runner-specific configuration file path'),
  retry: RetryPolicySchema.optional().describe('Suite-level retry policy (overrides global)'),
  parallel: z.boolean().optional().describe('Enable parallel execution for this suite'),
  concurrency: z.number().optional().describe('Maximum concurrency for parallel test cases'),
}).describe('Test suite configuration');

/** Preset endpoint schema */
export const PresetEndpointSchema = z.object({
  method: z.string().describe('HTTP method'),
  path: z.string().describe('API endpoint path'),
  name: z.string().describe('Display name for the endpoint'),
  body: z.unknown().optional().describe('Default request body'),
}).describe('Predefined API endpoint for the dashboard explorer');

/** Preset group schema */
export const PresetGroupSchema = z.object({
  group: z.string().describe('Group name for organizing endpoints'),
  endpoints: z.array(PresetEndpointSchema).describe('Endpoints in this group'),
}).describe('Grouped preset API endpoints');

/** Repo configuration schema */
export const RepoConfigSchema = z.object({
  name: z.string().describe('Repository name'),
  path: z.string().optional().describe('Local path (relative to e2e.yaml directory)'),
  url: z.string().optional().describe('Remote repository URL (SSH or HTTPS)'),
  branch: z.string().optional().describe('Default branch name for checkout'),
}).describe('Git repository configuration for branch selection and builds');

/** Dashboard configuration schema */
export const DashboardSchema = z.object({
  port: z.number().default(9095).describe('Dashboard API server port'),
  uiPort: z.number().default(9091).describe('Dashboard UI dev server port'),
  presets: z.array(PresetGroupSchema).optional().describe('Predefined API endpoints for the explorer'),
  envDefaults: z.record(z.string()).optional().describe('Default environment variable values for the env editor'),
  defaultDirs: z.array(z.string()).optional().describe('Default directories to browse inside the container'),
}).describe('Dashboard configuration');

/** Network configuration schema */
export const NetworkSchema = z.object({
  name: z.string().default('e2e-network').describe('Docker network name for inter-container communication'),
}).describe('Docker network configuration');

// =====================================================================
// Resilience Configuration Schema
// =====================================================================

/** Resilience subsystem Zod schema with sensible defaults for all sub-sections. */
export const ResilienceConfigSchema = z.object({
  preflight: z.object({
    enabled: z.boolean().default(true).describe('Enable automatic preflight health checks before setup/build'),
    diskSpaceThreshold: z.string().default('2GB').describe('Minimum free disk space required (e.g. "2GB", "500MB")'),
    cleanOrphans: z.boolean().default(true).describe('Auto-remove orphaned ArgusAI containers and networks'),
  }).default({}).describe('Preflight environment health check configuration'),
  container: z.object({
    restartOnFailure: z.boolean().default(true).describe('Auto-restart containers that crash during test execution'),
    maxRestarts: z.number().min(0).max(10).default(3).describe('Maximum restart attempts before giving up (0-10)'),
    restartDelay: z.string().default('2s').describe('Base delay between restart attempts (e.g. "2s", "500ms")'),
    restartBackoff: z.enum(['exponential', 'linear']).default('exponential').describe('Backoff strategy for restart delays'),
  }).default({}).describe('Container failure recovery configuration'),
  network: z.object({
    portConflictStrategy: z.enum(['auto', 'fail']).default('auto').describe('How to handle port conflicts: "auto" finds alternatives, "fail" aborts'),
    verifyConnectivity: z.boolean().default(true).describe('Verify mock service reachability before running tests'),
  }).default({}).describe('Network resilience and port conflict resolution'),
  circuitBreaker: z.object({
    enabled: z.boolean().default(true).describe('Enable circuit breaker for Docker operations'),
    failureThreshold: z.number().min(1).max(20).default(5).describe('Consecutive failures before circuit opens (1-20)'),
    resetTimeoutMs: z.number().default(30000).describe('Time in ms before auto-transitioning from open to half-open'),
  }).default({}).describe('Circuit breaker pattern for Docker CLI operations'),
}).default({}).describe('Resilience subsystem configuration — error recovery, preflight, circuit breaker');

// =====================================================================
// History Configuration Schema
// =====================================================================

/** History subsystem Zod schema with sensible defaults for persistence and flaky detection. */
export const HistoryConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable test result persistence'),
  storage: z.enum(['local', 'memory']).default('local').describe('Storage backend: local SQLite or in-memory'),
  path: z.string().optional().describe('Custom SQLite database file path'),
  retention: z.object({
    maxAge: z.string().default('90d').describe('Maximum age of retained runs (e.g. "90d")'),
    maxRuns: z.number().min(10).max(100000).default(1000).describe('Maximum number of runs to retain'),
  }).default({}).describe('Retention policy configuration'),
  flakyWindow: z.number().min(2).max(100).default(10).describe('Number of recent runs for flaky detection window'),
}).default({}).describe('Test result history persistence and flaky detection configuration');

// =====================================================================
// Isolation Configuration Schema
// =====================================================================

/** Multi-project isolation Zod schema. */
export const IsolationConfigSchema = z.object({
  namespace: z.string().optional()
    .describe('Custom namespace prefix for Docker resources (containers, networks). Defaults to a slug of the project name.'),
  portRange: z.tuple([z.number().min(1024).max(65535), z.number().min(1024).max(65535)]).optional()
    .describe('Port allocation range [start, end] (inclusive) for auto-assignment. Defaults to [9000, 9999].'),
}).optional().describe('Multi-project isolation and resource namespace configuration');

// =====================================================================
// Complete E2E Configuration Schema
// =====================================================================

/** Complete E2E configuration Zod schema */
export const E2EConfigSchema = z.object({
  version: z.string().default('1').describe('Configuration schema version'),
  project: z.object({
    name: z.string().describe('Project name'),
    description: z.string().optional().describe('Project description'),
    version: z.string().optional().describe('Project version'),
  }).describe('Project metadata'),
  service: z.object({
    build: ServiceBuildSchema,
    container: ServiceContainerSchema,
    vars: z.record(z.string()).optional().describe('Custom variables for template substitution'),
  }).optional().describe('Service under test (single service, backward compatible)'),
  services: z.preprocess((val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.entries(val as Record<string, unknown>).map(([key, svc]) => ({
        name: key,
        ...(svc as Record<string, unknown>),
      }));
    }
    return val;
  }, z.array(ServiceDefinitionSchema).optional()).describe('Multiple services for multi-service orchestration'),
  mocks: z.record(MockServiceSchema).optional().describe('Mock service definitions keyed by name'),
  tests: z.object({
    suites: z.array(TestSuiteSchema).describe('Test suite definitions'),
    retry: RetryPolicySchema.optional().describe('Global retry policy for all test cases'),
    parallel: ParallelConfigSchema.optional().describe('Global parallel execution configuration'),
  }).optional().describe('Test configuration and suite definitions'),
  dashboard: DashboardSchema.optional().describe('Dashboard UI configuration'),
  network: NetworkSchema.optional().describe('Docker network configuration'),
  repos: z.array(RepoConfigSchema).optional().describe('Git repositories for branch selection and builds'),
  resilience: ResilienceConfigSchema.optional().describe('Resilience subsystem — error recovery, preflight, circuit breaker'),
  history: HistoryConfigSchema.optional().describe('Test result history persistence and flaky detection'),
  isolation: IsolationConfigSchema.describe('Multi-project isolation — namespace, port range'),
}).describe('Preflight E2E test configuration');

/** Validated configuration type inferred from the Zod schema */
export type ValidatedE2EConfig = z.infer<typeof E2EConfigSchema>;

// =====================================================================
// Config Loader
// =====================================================================

/**
 * Load and validate a preflight configuration file.
 *
 * Steps:
 * 1. Load `.env` from the config file's directory
 * 2. Read the YAML configuration file
 * 3. Parse YAML content
 * 4. Substitute `{{env.XXX}}` and `{{config.xxx}}` variables
 * 5. Validate with Zod schema
 *
 * @param configPath - Path to the configuration file.
 *   Defaults to `e2e.yaml` or `e2e.yml` in the current working directory.
 * @returns Validated E2E configuration
 * @throws {Error} If file not found, YAML syntax error, or validation fails
 */
export async function loadConfig(configPath?: string): Promise<E2EConfig> {
  // Resolve config file path
  const resolvedPath = await resolveConfigPath(configPath);

  // 1. Load .env file from the config file's directory
  const configDir = path.dirname(resolvedPath);
  dotenv.config({ path: path.resolve(configDir, '.env') });

  // 2. Read YAML file
  let rawContent: string;
  try {
    rawContent = await fs.readFile(resolvedPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${resolvedPath}`);
    }
    throw err;
  }

  // 3. Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(rawContent);
  } catch (err) {
    throw new Error(
      `YAML syntax error in ${resolvedPath}: ${(err as Error).message}`,
    );
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    throw new Error(
      `Configuration file is empty or not a valid object: ${resolvedPath}`,
    );
  }

  // 4. Variable substitution (env variables + config vars)
  const rawConfig = parsed as Record<string, unknown>;
  const vars = extractVars(rawConfig);
  const context = {
    config: vars,
    runtime: {},
    env: { ...process.env } as Record<string, string>,
  };
  const resolved = resolveObjectVariables(rawConfig, context);

  // 5. Zod validation
  const result = E2EConfigSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }

  // 6. Resolve build paths to absolute (relative to e2e.yaml directory)
  const validated = result.data as E2EConfig;
  resolveBuildPathsInConfig(validated, configDir);

  return validated;
}

// =====================================================================
// Internal Helpers
// =====================================================================

/**
 * Resolve the configuration file path.
 * If no explicit path is given, looks for `e2e.yaml` then `e2e.yml` in cwd.
 */
async function resolveConfigPath(configPath?: string): Promise<string> {
  if (configPath) {
    return path.resolve(configPath);
  }

  const cwd = process.cwd();
  const yamlPath = path.resolve(cwd, 'e2e.yaml');
  const ymlPath = path.resolve(cwd, 'e2e.yml');

  try {
    await fs.access(yamlPath);
    return yamlPath;
  } catch {
    // Try .yml extension
  }

  try {
    await fs.access(ymlPath);
    return ymlPath;
  } catch {
    // Neither found
  }

  throw new Error(
    `Configuration file not found. Looked for:\n  - ${yamlPath}\n  - ${ymlPath}`,
  );
}

/**
 * Extract vars from the raw parsed config object (before Zod validation).
 * Checks `service.vars` (single) and first entry of `services[].vars` (multi).
 */
function extractVars(raw: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  const extractFromObj = (obj: unknown) => {
    if (obj && typeof obj === 'object' && obj !== null) {
      const vars = (obj as Record<string, unknown>)['vars'];
      if (vars && typeof vars === 'object' && vars !== null) {
        for (const [key, value] of Object.entries(vars as Record<string, unknown>)) {
          result[key] = String(value);
        }
      }
    }
  };

  extractFromObj(raw['service']);

  const services = raw['services'];
  if (Array.isArray(services)) {
    for (const svc of services) {
      extractFromObj(svc);
    }
  }

  return result;
}

/**
 * Resolve build-related paths (dockerfile, context) to absolute paths
 * relative to the config file directory. This ensures Docker commands
 * work regardless of the process working directory.
 */
function resolveBuildPathsInConfig(config: E2EConfig, configDir: string): void {
  if (config.service) {
    config.service.build.dockerfile = path.resolve(configDir, config.service.build.dockerfile);
    config.service.build.context = path.resolve(configDir, config.service.build.context);
  }
  if (config.services) {
    for (const svc of config.services) {
      svc.build.dockerfile = path.resolve(configDir, svc.build.dockerfile);
      svc.build.context = path.resolve(configDir, svc.build.context);
    }
  }
}
