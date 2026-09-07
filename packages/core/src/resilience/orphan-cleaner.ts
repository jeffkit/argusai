/**
 * @module resilience/orphan-cleaner
 * Detect and clean up orphaned Docker resources from previous ArgusAI runs.
 *
 * Uses Docker labels (`argusai.managed`, `argusai.project`, `argusai.run-id`)
 * to identify resources. Only touches resources belonging to the current
 * project — cross-project isolation is enforced.
 */

import type {
  OrphanResource,
  OrphanCleanupResult,
  SSEBus,
} from '../types.js';
import { dockerExec } from '../docker-engine.js';

// =====================================================================
// OrphanCleaner
// =====================================================================

export class OrphanCleaner {
  constructor(
    private currentProject: string,
    private currentRunId: string,
    private eventBus?: SSEBus,
  ) {}

  /**
   * Detect orphaned containers and networks for the current project.
   *
   * Excludes resources belonging to the current `runId`.
   */
  async detect(): Promise<OrphanResource[]> {
    const orphans: OrphanResource[] = [];

    try {
      const containerOutput = await dockerExec([
        'ps', '-a',
        '--filter', 'label=argusai.managed=true',
        '--filter', `label=argusai.project=${this.currentProject}`,
        '--format', '{{.ID}}\t{{.Names}}\t{{.Labels}}',
      ]);

      for (const line of containerOutput.split('\n')) {
        if (!line.trim()) continue;
        const [id, name, labels] = line.split('\t');
        if (!id || !name) continue;

        const runId = extractLabel(labels ?? '', 'argusai.run-id');
        if (runId === this.currentRunId) continue;

        const createdAt = extractLabel(labels ?? '', 'argusai.created-at');

        orphans.push({
          type: 'container',
          name: name.trim(),
          id: id.trim(),
          project: this.currentProject,
          runId: runId ?? 'unknown',
          createdAt: createdAt ?? 'unknown',
        });
      }
    } catch {
      // docker ps failed — skip container detection
    }

    try {
      const networkOutput = await dockerExec([
        'network', 'ls',
        '--filter', 'label=argusai.managed=true',
        '--filter', `label=argusai.project=${this.currentProject}`,
        '--format', '{{.ID}}\t{{.Name}}\t{{.Labels}}',
      ]);

      for (const line of networkOutput.split('\n')) {
        if (!line.trim()) continue;
        const [id, name, labels] = line.split('\t');
        if (!id || !name) continue;

        const runId = extractLabel(labels ?? '', 'argusai.run-id');
        if (runId === this.currentRunId) continue;

        const createdAt = extractLabel(labels ?? '', 'argusai.created-at');

        orphans.push({
          type: 'network',
          name: name.trim(),
          id: id.trim(),
          project: this.currentProject,
          runId: runId ?? 'unknown',
          createdAt: createdAt ?? 'unknown',
        });
      }
    } catch {
      // docker network ls failed — skip network detection
    }

    return orphans;
  }

  /**
   * Clean up a list of orphan resources.
   *
   * Removes containers before networks (containers may be attached).
   * Each removal is independent — failure of one does not block others.
   */
  async cleanup(orphans: OrphanResource[]): Promise<OrphanCleanupResult> {
    const start = Date.now();
    const removed: OrphanResource[] = [];
    const failed: Array<OrphanResource & { error: string }> = [];

    const containers = orphans.filter(o => o.type === 'container');
    const networks = orphans.filter(o => o.type === 'network');
    const volumes = orphans.filter(o => o.type === 'volume');

    for (const orphan of containers) {
      try {
        await dockerExec(['rm', '-f', orphan.id]);
        removed.push(orphan);
        this.emitResourceEvent(orphan, 'removed');
      } catch (err) {
        failed.push({
          ...orphan,
          error: err instanceof Error ? err.message : String(err),
        });
        this.emitResourceEvent(orphan, 'failed');
      }
    }

    for (const orphan of networks) {
      try {
        await dockerExec(['network', 'rm', orphan.id]);
        removed.push(orphan);
        this.emitResourceEvent(orphan, 'removed');
      } catch (err) {
        failed.push({
          ...orphan,
          error: err instanceof Error ? err.message : String(err),
        });
        this.emitResourceEvent(orphan, 'failed');
      }
    }

    for (const orphan of volumes) {
      try {
        await dockerExec(['volume', 'rm', orphan.id]);
        removed.push(orphan);
        this.emitResourceEvent(orphan, 'removed');
      } catch (err) {
        failed.push({
          ...orphan,
          error: err instanceof Error ? err.message : String(err),
        });
        this.emitResourceEvent(orphan, 'failed');
      }
    }

    return {
      found: orphans,
      removed,
      failed,
      duration: Date.now() - start,
    };
  }

  /**
   * Detect and clean up orphaned resources in a single operation.
   *
   * Emits SSE events throughout the lifecycle:
   * cleanup_start, cleanup_resource (per item), cleanup_end.
   */
  async detectAndCleanup(): Promise<OrphanCleanupResult> {
    this.eventBus?.emit('resilience', {
      event: 'cleanup_start',
      data: {
        type: 'cleanup_start',
        project: this.currentProject,
        timestamp: Date.now(),
      },
    });

    const orphans = await this.detect();

    // Networks can outlive their containers when a previous cleanup was
    // interrupted (e.g. MCP restart between clean and network removal).
    // detect() only reports networks from *other* run-ids, so also sweep
    // empty ones of this project (issue #11).
    const sweep = await removeEmptyManagedNetworks({
      project: this.currentProject,
      eventBus: this.eventBus,
    });

    if (orphans.length === 0) {
      const result: OrphanCleanupResult = {
        found: [],
        removed: sweep.removed,
        failed: sweep.failed,
        duration: 0,
      };
      this.emitEndEvent(result);
      return result;
    }

    const result = await this.cleanup(orphans);
    result.removed.push(...sweep.removed);
    result.failed.push(...sweep.failed);

    this.emitEndEvent(result);
    return result;
  }

  private emitResourceEvent(orphan: OrphanResource, action: string): void {
    this.eventBus?.emit('resilience', {
      event: 'cleanup_resource',
      data: {
        type: 'cleanup_resource',
        resourceType: orphan.type,
        name: orphan.name,
        action,
        timestamp: Date.now(),
      },
    });
  }

  private emitEndEvent(result: OrphanCleanupResult): void {
    this.eventBus?.emit('resilience', {
      event: 'cleanup_end',
      data: {
        type: 'cleanup_end',
        found: result.found.length,
        removed: result.removed.length,
        failed: result.failed.length,
        timestamp: Date.now(),
      },
    });
  }
}

// =====================================================================
// Helpers
// =====================================================================

function extractLabel(labelsStr: string, key: string): string | null {
  for (const part of labelsStr.split(',')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${key}=`)) {
      return trimmed.slice(key.length + 1);
    }
  }
  return null;
}

// =====================================================================
// Empty Managed Network Sweep
// =====================================================================

export interface EmptyNetworkSweepResult {
  removed: OrphanResource[];
  failed: Array<OrphanResource & { error: string }>;
  /** Networks left alone (still has containers, or younger than the grace period). */
  skipped: string[];
}

export interface EmptyNetworkSweepOptions {
  /** Restrict the sweep to one project's networks. Omit to sweep all projects. */
  project?: string;
  /**
   * Skip networks created less than this many ms ago, so a concurrent setup
   * that has created its network but not attached containers yet is not
   * disrupted. Networks without a `argusai.created-at` label are not
   * grace-checked (their emptiness alone decides). Default: 60s.
   */
  graceMs?: number;
  eventBus?: SSEBus;
}

/**
 * Remove argusai-managed Docker networks that have no containers attached.
 *
 * `argus-clean` only removes the network of a live session; networks whose
 * session died (MCP restart, TTL expiry) lingered forever and gradually
 * exhausted the Docker address pool (issue #11). An empty managed network is
 * inert by definition, so removing it is always safe.
 */
export async function removeEmptyManagedNetworks(
  options: EmptyNetworkSweepOptions = {},
): Promise<EmptyNetworkSweepResult> {
  const { project, graceMs = 60_000, eventBus } = options;
  const result: EmptyNetworkSweepResult = { removed: [], failed: [], skipped: [] };

  let output: string;
  try {
    const args = [
      'network', 'ls',
      '--filter', 'label=argusai.managed=true',
      '--format', '{{.ID}}\t{{.Name}}\t{{.Labels}}',
    ];
    if (project) args.push('--filter', `label=argusai.project=${project}`);
    output = await dockerExec(args);
  } catch {
    // Docker unreachable — nothing to sweep
    return result;
  }

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [id, name, labels] = line.split('\t');
    if (!id || !name) continue;
    const netName = name.trim();

    const createdAt = extractLabel(labels ?? '', 'argusai.created-at');
    if (createdAt) {
      const age = Date.now() - Date.parse(createdAt);
      if (Number.isFinite(age) && age < graceMs) {
        result.skipped.push(netName);
        continue;
      }
    }

    let containerCount = -1;
    try {
      const inspectOut = await dockerExec([
        'network', 'inspect', netName, '--format', '{{len .Containers}}',
      ]);
      containerCount = parseInt(inspectOut.trim(), 10);
    } catch {
      // Inspect failure — treat as non-empty rather than risk removing a
      // network we cannot verify.
    }
    if (containerCount !== 0) {
      result.skipped.push(netName);
      continue;
    }

    const resource: OrphanResource = {
      type: 'network',
      name: netName,
      id: id.trim(),
      project: extractLabel(labels ?? '', 'argusai.project') ?? project ?? 'unknown',
      runId: extractLabel(labels ?? '', 'argusai.run-id') ?? 'unknown',
      createdAt: createdAt ?? 'unknown',
    };

    eventBus?.emit('resilience', {
      event: 'cleanup_resource',
      data: { type: 'cleanup_resource', resourceType: 'network', name: netName, action: 'removing', timestamp: Date.now() },
    });

    try {
      await dockerExec(['network', 'rm', netName]);
      result.removed.push(resource);
      eventBus?.emit('resilience', {
        event: 'cleanup_resource',
        data: { type: 'cleanup_resource', resourceType: 'network', name: netName, action: 'removed', timestamp: Date.now() },
      });
    } catch (err) {
      result.failed.push({
        ...resource,
        error: err instanceof Error ? err.message : String(err),
      });
      eventBus?.emit('resilience', {
        event: 'cleanup_resource',
        data: { type: 'cleanup_resource', resourceType: 'network', name: netName, action: 'failed', timestamp: Date.now() },
      });
    }
  }

  return result;
}
