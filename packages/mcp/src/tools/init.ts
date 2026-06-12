/**
 * @module tools/init
 * argus_init — Initialize a project session by loading e2e.yaml.
 */

import path from 'node:path';
import { loadConfig, loadPlugins } from 'argusai-core';
import type { E2EConfig, ServiceConfig, ServiceDefinition, MockServiceConfig, TestSuiteConfig } from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';

export interface InitResult {
  projectName: string;
  configPath: string;
  services: Array<{
    name: string;
    image: string;
    ports: string[];
    hasHealthcheck: boolean;
  }>;
  mocks: Array<{
    name: string;
    port: number;
    routeCount: number;
  }>;
  suites: Array<{
    id: string;
    name: string;
    runner: string;
    file?: string;
  }>;
  schemaVersion: string;
}

function extractServices(config: E2EConfig): InitResult['services'] {
  if (config.services && config.services.length > 0) {
    return config.services.map((svc: ServiceDefinition) => ({
      name: svc.name,
      image: svc.build.image,
      ports: svc.container.ports,
      hasHealthcheck: !!svc.container.healthcheck,
    }));
  }

  if (config.service) {
    const svc: ServiceConfig = config.service;
    return [{
      name: svc.container.name,
      image: svc.build.image,
      ports: svc.container.ports,
      hasHealthcheck: !!svc.container.healthcheck,
    }];
  }

  return [];
}

/**
 * Handle the argus_init MCP tool call.
 * Loads the project e2e.yaml config and creates a new session.
 *
 * @param params - Tool input with projectPath and optional configFile override
 * @param sessionManager - Session store for tracking project state
 * @returns Structured init result with project info, services, mocks, and suites
 * @throws {SessionError} SESSION_EXISTS if already initialized, CONFIG_NOT_FOUND/CONFIG_INVALID on bad config
 */
export async function handleInit(
  params: { projectPath: string; configFile?: string },
  sessionManager: SessionManager,
): Promise<InitResult> {
  const { projectPath, configFile } = params;

  if (sessionManager.has(projectPath)) {
    const existing = sessionManager.getOrThrow(projectPath);
    // A lazily-created session (e.g. from a read-only tool like argus_history)
    // has no live Docker resources, so an explicit init may safely replace it.
    // A real, already-initialized/built/running session is left untouched.
    if (existing.lazy && existing.state === 'initialized') {
      // Release the shared SQLite handle the lazy session opened before the
      // fresh init reopens it (knowledge store shares the same connection).
      try { existing.knowledgeStore?.close(); } catch { /* ignore */ }
      try { existing.historyStore?.close(); } catch { /* ignore */ }
      sessionManager.remove(projectPath);
    } else {
      throw new SessionError('SESSION_EXISTS', `Session already initialized for project: ${projectPath}`);
    }
  }

  const configFileName = configFile ?? 'e2e.yaml';
  const configPath = path.resolve(projectPath, configFileName);

  let config: E2EConfig;
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not found')) {
      throw new SessionError('CONFIG_NOT_FOUND', `Configuration file not found: ${configPath}`);
    }
    if (message.includes('validation failed')) {
      throw new SessionError('CONFIG_INVALID', message);
    }
    throw err;
  }

  if (config.plugins && config.plugins.length > 0) {
    try {
      await loadPlugins(config.plugins, projectPath);
    } catch (err) {
      throw new SessionError('PLUGIN_LOAD_ERROR', `Plugin load failed: ${(err as Error).message}`);
    }
  }

  sessionManager.create(projectPath, config, configPath);

  sessionManager.eventBus?.emit('activity', {
    event: 'activity_start',
    data: { id: `init-${Date.now()}`, source: 'ai', operation: 'init', project: config.project.name, status: 'success', startTime: Date.now(), endTime: Date.now() },
  });

  const services = extractServices(config);

  const mocks: InitResult['mocks'] = [];
  if (config.mocks) {
    for (const [name, mockConfig] of Object.entries(config.mocks)) {
      const mc = mockConfig as MockServiceConfig;
      mocks.push({
        name,
        port: mc.port,
        routeCount: mc.routes?.length ?? 0,
      });
    }
  }

  const suites: InitResult['suites'] = [];
  if (config.tests?.suites) {
    for (const suite of config.tests.suites) {
      const s = suite as TestSuiteConfig;
      suites.push({
        id: s.id,
        name: s.name,
        runner: s.runner ?? 'yaml',
        file: s.file,
      });
    }
  }

  return {
    projectName: config.project.name,
    configPath,
    services,
    mocks,
    suites,
    schemaVersion: config.version,
  };
}
