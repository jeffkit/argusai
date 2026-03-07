/**
 * @module tools/build
 * argus_build — Build Docker images for project services.
 */

import {
  buildImage,
  dockerExec,
  PreflightChecker,
  ResilientDockerEngine,
  ArgusError,
  type E2EConfig,
  type ServiceConfig,
  type ServiceDefinition,
  type BuildEvent,
} from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';
import type { PlatformServices } from '../server.js';

export interface BuildResult {
  services: Array<{
    name: string;
    image: string;
    status: 'success' | 'failed';
    duration: number;
    error?: string;
  }>;
  totalDuration: number;
}

interface ServiceBuildTarget {
  name: string;
  build: { dockerfile: string; context: string; image: string; args?: Record<string, string> };
}

function getServicesToBuild(config: E2EConfig, serviceFilter?: string): ServiceBuildTarget[] {
  const targets: ServiceBuildTarget[] = [];

  if (config.services && config.services.length > 0) {
    for (const svc of config.services) {
      if (serviceFilter && svc.name !== serviceFilter) continue;
      targets.push({ name: svc.name, build: svc.build });
    }
  } else if (config.service) {
    const svc: ServiceConfig = config.service;
    if (!serviceFilter || svc.container.name === serviceFilter) {
      targets.push({ name: svc.container.name, build: svc.build });
    }
  }

  if (serviceFilter && targets.length === 0) {
    throw new SessionError('SERVICE_NOT_FOUND', `Service "${serviceFilter}" not found in configuration`);
  }

  return targets;
}

/**
 * Handle the argus_build MCP tool call.
 * Builds Docker images for one or all services in the project.
 *
 * @param params - Tool input with projectPath, optional noCache and service filter
 * @param sessionManager - Session store for tracking project state
 * @returns Build results per service with status and timing
 * @throws {SessionError} SESSION_NOT_FOUND if not initialized, SERVICE_NOT_FOUND if filter matches nothing
 */
export async function handleBuild(
  params: { projectPath: string; noCache?: boolean; service?: string; useExisting?: boolean },
  sessionManager: SessionManager,
  platform?: PlatformServices,
): Promise<BuildResult> {
  const session = sessionManager.getOrThrow(params.projectPath);
  const bus = sessionManager.eventBus;

  // Preflight gate: check Docker daemon and disk space before building
  const resilienceConfig = session.config.resilience;
  if (resilienceConfig?.preflight?.enabled !== false) {
    const checker = new PreflightChecker(bus);
    const dockerCheck = await checker.checkDockerDaemon();
    if (dockerCheck.status === 'fail') {
      throw new ArgusError('DOCKER_UNAVAILABLE', 'Docker daemon is not reachable', {
        check: dockerCheck,
      });
    }
    const diskCheck = await checker.checkDiskSpace(
      resilienceConfig?.preflight?.diskSpaceThreshold ?? '2GB',
    );
    if (diskCheck.status === 'fail') {
      throw new ArgusError('DISK_SPACE_LOW', diskCheck.message, {
        check: diskCheck,
      });
    }
  }

  const targets = getServicesToBuild(session.config, params.service);

  const totalStart = Date.now();
  const results: BuildResult['services'] = [];

  bus?.emit('activity', {
    event: 'activity_start',
    data: { id: `build-${totalStart}`, source: 'ai', operation: 'build', project: session.config.project.name, status: 'running', startTime: totalStart },
  });

  const resilientEngine = session.circuitBreaker
    ? new ResilientDockerEngine(session.circuitBreaker)
    : undefined;

  for (const target of targets) {
    const buildStart = Date.now();
    let lineNumber = 0;
    let buildError: string | undefined;
    const recentLogs: string[] = [];
    const MAX_ERROR_LOG_LINES = 30;

    if (params.useExisting) {
      try {
        await dockerExec(['image', 'inspect', target.build.image]);
        results.push({
          name: target.name,
          image: target.build.image,
          status: 'success',
          duration: Date.now() - buildStart,
        });
        continue;
      } catch {
        // Image doesn't exist, proceed with build
      }
    }

    try {
      const buildOpts = {
        dockerfile: target.build.dockerfile,
        context: target.build.context,
        imageName: target.build.image,
        buildArgs: target.build.args,
        noCache: params.noCache,
      };

      const buildGen = resilientEngine
        ? resilientEngine.buildImage(buildOpts)
        : buildImage(buildOpts);

      for await (const event of buildGen) {
        bus?.emit('build', { event: event.type, data: event });
        if (event.type === 'build_log') {
          lineNumber++;
          recentLogs.push(event.line);
          if (recentLogs.length > MAX_ERROR_LOG_LINES) {
            recentLogs.shift();
          }
        }
        if (event.type === 'build_end' && !event.success) {
          buildError = event.error;
        }
      }
    } catch (err) {
      buildError = (err as Error).message;
    }

    if (buildError && recentLogs.length > 0) {
      buildError = `${buildError}\n--- Last ${recentLogs.length} lines of build output ---\n${recentLogs.join('\n')}`;
    }

    results.push({
      name: target.name,
      image: target.build.image,
      status: buildError ? 'failed' : 'success',
      duration: Date.now() - buildStart,
      error: buildError,
    });
  }

  const anyFailed = results.some(r => r.status === 'failed');
  if (!anyFailed) {
    sessionManager.transition(params.projectPath, 'built');
  }

  const totalDuration = Date.now() - totalStart;
  bus?.emit('activity', {
    event: 'activity_update',
    data: { id: `build-${totalStart}`, source: 'ai', operation: 'build', project: session.config.project.name, status: anyFailed ? 'failed' : 'success', startTime: totalStart, endTime: Date.now() },
  });

  // Persist build records
  if (platform?.store) {
    for (const r of results) {
      platform.store.saveBuildRecord({
        id: `build-${totalStart}-${r.name}`,
        project: session.projectPath,
        image: r.image,
        status: r.status,
        duration: r.duration,
        timestamp: totalStart,
        source: 'ai',
        error: r.error,
      }).catch(() => {});
    }
  }

  // Notify on failure
  if (anyFailed && platform?.notifier) {
    const failedNames = results.filter(r => r.status === 'failed').map(r => r.name);
    platform.notifier.notifyBuildFailure(
      session.projectPath,
      failedNames.join(', '),
      results.find(r => r.error)?.error ?? 'Build failed',
    ).catch(() => {});
  }

  return { services: results, totalDuration };
}
