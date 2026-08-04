/**
 * @module resilience
 * Resilience subsystem — structured errors, preflight checks,
 * container guardian, port resolver, orphan cleaner, and circuit breaker.
 */

// Error Codes
export {
  type ArgusErrorCode,
  type ErrorCategory,
  type ErrorSeverity,
  type StructuredError,
  ERROR_METADATA,
  createStructuredError,
  ArgusError,
} from './error-codes.js';

// Preflight Health Check
export {
  PreflightChecker,
  computeOverallHealth,
} from './preflight.js';

// Container Guardian
export { ContainerGuardian } from './container-guardian.js';

// Port Resolver
export { PortResolver } from './port-resolver.js';

// Orphan Cleaner
export { OrphanCleaner } from './orphan-cleaner.js';

// Circuit Breaker
export { CircuitBreaker } from './circuit-breaker.js';

// Network Verifier
export { NetworkVerifier } from './network-verifier.js';

// =====================================================================
// ResilientDockerEngine — wraps Docker CLI calls through a circuit breaker
// =====================================================================

import { CircuitBreaker } from './circuit-breaker.js';
import {
  buildImage as rawBuildImage,
  startContainer as rawStartContainer,
  stopContainer as rawStopContainer,
  getContainerStatus as rawGetContainerStatus,
  getContainerLogs as rawGetContainerLogs,
  execInContainer as rawExecInContainer,
  dockerExec as rawDockerExec,
} from '../docker-engine.js';
import type { DockerRunOptions, DockerBuildOptions } from '../docker-engine.js';
import type { BuildEvent, ContainerStatus } from '../types.js';

/**
 * Wrapper that proxies Docker CLI calls through a CircuitBreaker.
 *
 * When the circuit is open, all operations fail fast with CIRCUIT_OPEN.
 * The underlying docker-engine functions are called unchanged when
 * the circuit is closed.
 */
export class ResilientDockerEngine {
  constructor(private circuitBreaker: CircuitBreaker) {}

  async startContainer(options: DockerRunOptions): Promise<string> {
    return this.circuitBreaker.execute(() => rawStartContainer(options));
  }

  async stopContainer(name: string): Promise<void> {
    return this.circuitBreaker.execute(() => rawStopContainer(name));
  }

  async getContainerStatus(name: string): Promise<ContainerStatus> {
    return this.circuitBreaker.execute(() => rawGetContainerStatus(name));
  }

  async getContainerLogs(name: string, lines?: number): Promise<string> {
    return this.circuitBreaker.execute(() => rawGetContainerLogs(name, lines));
  }

  async execInContainer(name: string, command: string): Promise<{ stdout: string; exitCode: number }> {
    return this.circuitBreaker.execute(() => rawExecInContainer(name, command));
  }

  async dockerExec(args: string[], timeoutMs?: number): Promise<string> {
    return this.circuitBreaker.execute(() => rawDockerExec(args, timeoutMs));
  }

  /**
   * Build an image through the circuit breaker.
   *
   * Since buildImage is an async generator, we wrap the entire
   * iteration in a single circuit breaker call that collects events.
   */
  async *buildImage(options: DockerBuildOptions): AsyncGenerator<BuildEvent> {
    const events: BuildEvent[] = [];

    await this.circuitBreaker.execute(async () => {
      for await (const event of rawBuildImage(options)) {
        events.push(event);
      }
      const lastEvent = events[events.length - 1];
      if (lastEvent && lastEvent.type === 'build_end' && !lastEvent.success) {
        throw new Error(lastEvent.error ?? 'Build failed');
      }
    });

    for (const event of events) {
      yield event;
    }
  }
}
