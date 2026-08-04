/**
 * @module orchestrator
 * MultiServiceOrchestrator — manages the lifecycle of multiple Docker
 * services: normalize config, build, start (respecting dependency order),
 * health-check, and cleanup.
 */

import type {
  E2EConfig,
  ServiceDefinition,
  ServiceConfig,
  BuildEvent,
  ResilienceConfig,
  OrphanCleanupResult,
  SSEBus,
} from './types.js';
import {
  buildImage,
  startContainer,
  stopContainer,
  ensureNetwork,
  removeNetwork,
  waitForHealthy,
  getContainerStatus,
} from './docker-engine.js';
import type { DockerBuildOptions, DockerRunOptions } from './docker-engine.js';
import { ContainerGuardian } from './resilience/container-guardian.js';
import { OrphanCleaner } from './resilience/orphan-cleaner.js';

export interface OrchestratorServiceResult {
  name: string;
  containerId: string;
  status: 'running' | 'healthy' | 'unhealthy' | 'failed';
  error?: string;
  healthCheckDuration?: number;
}

export interface BuildAllResult {
  services: Array<{
    name: string;
    image: string;
    status: 'success' | 'failed';
    duration: number;
    error?: string;
  }>;
  totalDuration: number;
}

export interface CleanAllResult {
  containers: Array<{
    name: string;
    action: 'removed' | 'failed';
    error?: string;
  }>;
  network: {
    name: string;
    action: 'removed' | 'failed' | 'skipped';
    error?: string;
  };
  orphanCleanup?: OrphanCleanupResult;
}

/**
 * Manages the lifecycle of multiple Docker services for E2E testing.
 *
 * Handles normalization of single-service configs to multi-service format,
 * parallel image builds, dependency-ordered container startup, health
 * checking, and comprehensive cleanup.
 */
export class MultiServiceOrchestrator {
  /**
   * Normalize an E2EConfig so that the `services` array is always populated.
   * If only `service` (singular) is defined, it wraps it as `services[0]`.
   *
   * @returns Array of ServiceDefinition (may be empty if neither field is set)
   */
  normalizeServices(config: E2EConfig): ServiceDefinition[] {
    if (config.services && config.services.length > 0) {
      return config.services;
    }

    if (config.service) {
      return [this.serviceConfigToDefinition(config.service)];
    }

    return [];
  }

  /**
   * Build Docker images for all services in parallel.
   *
   * @param services - Services to build
   * @param options - Build options (noCache, contextBaseDir)
   * @returns Build results per service
   */
  async buildAll(
    services: ServiceDefinition[],
    options?: { noCache?: boolean },
  ): Promise<BuildAllResult> {
    const totalStart = Date.now();

    const results = await Promise.allSettled(
      services.map(async (svc) => {
        const buildStart = Date.now();

        // Host-runtime services have no build config (no image to build).
        if (!svc.build) {
          return {
            name: svc.name,
            image: 'host',
            status: 'success' as const,
            duration: 0,
            error: undefined,
          };
        }

        const buildOpts: DockerBuildOptions = {
          dockerfile: svc.build.dockerfile,
          context: svc.build.context,
          imageName: svc.build.image,
          buildArgs: svc.build.args,
          noCache: options?.noCache,
        };

        let buildError: string | undefined;
        for await (const event of buildImage(buildOpts)) {
          if (event.type === 'build_end' && !event.success) {
            buildError = event.error;
          }
        }

        return {
          name: svc.name,
          image: svc.build.image,
          status: buildError ? 'failed' as const : 'success' as const,
          duration: Date.now() - buildStart,
          error: buildError,
        };
      }),
    );

    return {
      services: results.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : {
              name: 'unknown',
              image: 'unknown',
              status: 'failed' as const,
              duration: 0,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            },
      ),
      totalDuration: Date.now() - totalStart,
    };
  }

  /**
   * Start all services on a shared Docker network, respecting `dependsOn` order.
   *
   * Services are started sequentially in topological order based on their
   * `dependsOn` declarations. Each service waits for its health check
   * (if configured) before the next dependent service starts.
   *
   * @param services - Services to start
   * @param networkName - Docker network name
   * @param healthTimeout - Max wait for health checks (ms, default 120000)
   * @returns Results per service
   */
  async startAll(
    services: ServiceDefinition[],
    networkName: string,
    healthTimeout = 120_000,
    options?: {
      resilienceConfig?: ResilienceConfig['container'];
      labels?: Record<string, string>;
      eventBus?: SSEBus;
      guardianMap?: Map<string, ContainerGuardian>;
    },
  ): Promise<OrchestratorServiceResult[]> {
    const ordered = this.topologicalSort(services);
    const results: OrchestratorServiceResult[] = [];

    for (const svc of ordered) {
      try {
        const runOpts: DockerRunOptions = {
          name: svc.container.name,
          image: svc.build?.image ?? 'host',
          ports: svc.container.ports,
          environment: svc.container.environment,
          volumes: svc.container.volumes,
          network: networkName,
          healthcheck: svc.container.healthcheck
            ? {
                cmd: `wget -qO- http://localhost${svc.container.healthcheck.path} || exit 1`,
                interval: svc.container.healthcheck.interval ?? '10s',
                timeout: svc.container.healthcheck.timeout ?? '5s',
                retries: svc.container.healthcheck.retries ?? 10,
                startPeriod: svc.container.healthcheck.startPeriod ?? '30s',
              }
            : undefined,
          labels: options?.labels,
        };

        const containerId = await startContainer(runOpts);

        let status: 'running' | 'healthy' | 'unhealthy' = 'running';
        let healthCheckDuration: number | undefined;

        if (svc.container.healthcheck) {
          const hcStart = Date.now();
          const isHealthy = await waitForHealthy(svc.container.name, healthTimeout);
          healthCheckDuration = Date.now() - hcStart;
          status = isHealthy ? 'healthy' : 'unhealthy';

          if (!isHealthy && options?.resilienceConfig?.restartOnFailure) {
            const guardian = new ContainerGuardian(options.resilienceConfig, options.eventBus);
            options.guardianMap?.set(svc.container.name, guardian);
            try {
              const history = await guardian.monitorAndRestart(
                svc.container.name,
                runOpts,
                options.labels ?? {},
              );
              if (history?.finalStatus === 'recovered') {
                status = 'healthy';
              }
            } catch {
              status = 'unhealthy';
            }
          }
        }

        results.push({
          name: svc.name,
          containerId,
          status,
          healthCheckDuration,
        });
      } catch (err) {
        results.push({
          name: svc.name,
          containerId: '',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Wait for all services to report healthy.
   *
   * @param services - Services to check
   * @param timeoutMs - Max wait per service (ms)
   * @returns Map of service name to healthy status
   */
  async healthCheckAll(
    services: ServiceDefinition[],
    timeoutMs = 120_000,
  ): Promise<Map<string, boolean>> {
    const ordered = this.topologicalSort(services);
    const results = new Map<string, boolean>();

    for (const svc of ordered) {
      if (svc.container.healthcheck) {
        const healthy = await waitForHealthy(svc.container.name, timeoutMs);
        results.set(svc.name, healthy);
      } else {
        results.set(svc.name, true);
      }
    }

    return results;
  }

  /**
   * Stop and remove all service containers and the shared network.
   * Uses best-effort cleanup — continues even if individual removals fail.
   * Optionally runs OrphanCleaner for comprehensive teardown.
   *
   * @param services - Services to clean up
   * @param networkName - Docker network to remove
   * @param orphanCleanup - Optional orphan cleanup parameters
   * @returns Cleanup results
   */
  async cleanAll(
    services: ServiceDefinition[],
    networkName?: string,
    orphanCleanup?: { projectName: string; runId: string; eventBus?: SSEBus },
  ): Promise<CleanAllResult> {
    const containerResults: CleanAllResult['containers'] = [];

    const cleanupPromises = services.map(async (svc) => {
      try {
        await stopContainer(svc.container.name);
        return { name: svc.name, action: 'removed' as const };
      } catch (err) {
        return {
          name: svc.name,
          action: 'failed' as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const results = await Promise.allSettled(cleanupPromises);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        containerResults.push(r.value);
      } else {
        containerResults.push({
          name: 'unknown',
          action: 'failed',
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    let networkResult: CleanAllResult['network'];
    if (networkName) {
      try {
        await removeNetwork(networkName);
        networkResult = { name: networkName, action: 'removed' };
      } catch (err) {
        networkResult = {
          name: networkName,
          action: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      networkResult = { name: '', action: 'skipped' };
    }

    let orphanCleanupResult: OrphanCleanupResult | undefined;
    if (orphanCleanup) {
      const cleaner = new OrphanCleaner(
        orphanCleanup.projectName,
        orphanCleanup.runId,
        orphanCleanup.eventBus,
      );
      orphanCleanupResult = await cleaner.detectAndCleanup();
    }

    return { containers: containerResults, network: networkResult, orphanCleanup: orphanCleanupResult };
  }

  /**
   * Topological sort of services based on `dependsOn` declarations.
   * Services with no dependencies come first, then their dependents.
   *
   * @throws {Error} If circular dependencies are detected
   */
  topologicalSort(services: ServiceDefinition[]): ServiceDefinition[] {
    const serviceMap = new Map<string, ServiceDefinition>();
    for (const svc of services) {
      serviceMap.set(svc.name, svc);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: ServiceDefinition[] = [];

    const visit = (name: string, path: string[]) => {
      if (visited.has(name)) return;

      if (visiting.has(name)) {
        const cycle = [...path, name].join(' → ');
        throw new Error(`Circular dependency detected: ${cycle}`);
      }

      visiting.add(name);

      const svc = serviceMap.get(name);
      if (!svc) {
        throw new Error(`Unknown service dependency: "${name}"`);
      }

      if (svc.dependsOn) {
        for (const dep of svc.dependsOn) {
          if (!serviceMap.has(dep)) {
            throw new Error(
              `Service "${name}" depends on unknown service "${dep}"`,
            );
          }
          visit(dep, [...path, name]);
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(svc);
    };

    for (const svc of services) {
      visit(svc.name, []);
    }

    return sorted;
  }

  private serviceConfigToDefinition(config: ServiceConfig): ServiceDefinition {
    return {
      name: config.container.name,
      build: config.build,
      container: config.container,
      vars: config.vars,
    };
  }
}
