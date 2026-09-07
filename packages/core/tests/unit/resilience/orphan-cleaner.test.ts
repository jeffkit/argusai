/**
 * Unit tests for resilience/orphan-cleaner module.
 *
 * Mocks dockerExec to avoid real Docker calls.
 * Covers: detect (filter by project, exclude current run),
 *         cleanup (partial failures), empty-orphan fast path,
 *         cross-project isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrphanResource, SSEBus, SSEMessage } from '../../../src/types.js';

vi.mock('../../../src/docker-engine.js', () => ({
  dockerExec: vi.fn(),
}));

import { dockerExec } from '../../../src/docker-engine.js';
import { OrphanCleaner, removeEmptyManagedNetworks } from '../../../src/resilience/orphan-cleaner.js';

const mockDockerExec = vi.mocked(dockerExec);

function createMockBus(): SSEBus & { events: Array<{ channel: string; msg: SSEMessage }> } {
  const events: Array<{ channel: string; msg: SSEMessage }> = [];
  return {
    events,
    emit(channel: string, msg: SSEMessage) {
      events.push({ channel, msg });
    },
    subscribe: () => () => {},
  };
}

describe('OrphanCleaner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =================================================================
  // detect
  // =================================================================

  describe('detect', () => {
    it('should return empty array when no orphans found', async () => {
      mockDockerExec.mockResolvedValue('');

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toEqual([]);
    });

    it('should detect orphaned containers from previous runs', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) {
          return 'abc123\told-container\targusai.run-id=old-run,argusai.created-at=2026-01-01';
        }
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.type).toBe('container');
      expect(orphans[0]!.name).toBe('old-container');
      expect(orphans[0]!.runId).toBe('old-run');
    });

    it('should exclude containers belonging to the current run', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) {
          return 'abc123\tmy-container\targusai.run-id=current-run,argusai.created-at=2026-01-01';
        }
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toHaveLength(0);
    });

    it('should detect orphaned networks', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('network') && args.includes('ls')) {
          return 'net123\told-network\targusai.run-id=old-run,argusai.created-at=2026-01-01';
        }
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.type).toBe('network');
    });

    it('should handle docker command failures gracefully', async () => {
      mockDockerExec.mockRejectedValue(new Error('Docker not available'));

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const orphans = await cleaner.detect();

      expect(orphans).toEqual([]);
    });
  });

  // =================================================================
  // cleanup
  // =================================================================

  describe('cleanup', () => {
    it('should remove containers before networks', async () => {
      const callOrder: string[] = [];
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args[0] === 'rm') callOrder.push('rm-container');
        if (args[0] === 'network' && args[1] === 'rm') callOrder.push('rm-network');
        return '';
      });

      const orphans: OrphanResource[] = [
        { type: 'network', name: 'net1', id: 'net-id', project: 'p', runId: 'old', createdAt: '' },
        { type: 'container', name: 'c1', id: 'c-id', project: 'p', runId: 'old', createdAt: '' },
      ];

      const cleaner = new OrphanCleaner('p', 'current');
      const result = await cleaner.cleanup(orphans);

      expect(callOrder[0]).toBe('rm-container');
      expect(callOrder[1]).toBe('rm-network');
      expect(result.removed).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('should isolate per-resource errors', async () => {
      let callCount = 0;
      mockDockerExec.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Resource busy');
        return '';
      });

      const orphans: OrphanResource[] = [
        { type: 'container', name: 'c1', id: 'c1-id', project: 'p', runId: 'old', createdAt: '' },
        { type: 'container', name: 'c2', id: 'c2-id', project: 'p', runId: 'old', createdAt: '' },
      ];

      const cleaner = new OrphanCleaner('p', 'current');
      const result = await cleaner.cleanup(orphans);

      expect(result.removed).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.name).toBe('c1');
      expect(result.failed[0]!.error).toContain('Resource busy');
    });

    it('should return zero-duration for empty orphan list', async () => {
      const cleaner = new OrphanCleaner('p', 'current');
      const result = await cleaner.cleanup([]);

      expect(result.found).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // =================================================================
  // detectAndCleanup
  // =================================================================

  describe('detectAndCleanup', () => {
    it('should detect and clean in one operation', async () => {
      let callIdx = 0;
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) {
          return 'c1-id\torphan-c1\targusai.run-id=old-run,argusai.created-at=2026-01-01';
        }
        if (args[0] === 'rm') {
          return '';
        }
        return '';
      });

      const bus = createMockBus();
      const cleaner = new OrphanCleaner('my-project', 'current-run', bus);
      const result = await cleaner.detectAndCleanup();

      expect(result.found).toHaveLength(1);
      expect(result.removed).toHaveLength(1);

      const eventTypes = bus.events.map(e => (e.msg as { event: string }).event);
      expect(eventTypes).toContain('cleanup_start');
      expect(eventTypes).toContain('cleanup_resource');
      expect(eventTypes).toContain('cleanup_end');
    });

    it('should emit cleanup_end with zero counts when no orphans exist', async () => {
      mockDockerExec.mockResolvedValue('');

      const bus = createMockBus();
      const cleaner = new OrphanCleaner('my-project', 'current-run', bus);
      const result = await cleaner.detectAndCleanup();

      expect(result.found).toHaveLength(0);

      const endEvent = bus.events.find(
        e => (e.msg as { event: string }).event === 'cleanup_end',
      );
      expect(endEvent).toBeDefined();
    });

    it('should sweep empty managed networks of the project (issue #11)', async () => {
      mockDockerExec.mockImplementation(async (args: string[]) => {
        if (args.includes('ps')) return '';
        if (args.includes('network') && args.includes('ls')) {
          // Current run-id: detect() must not report it, the sweep still reclaims it
          return `net123\targusai-stale-network\targusai.managed=true,argusai.project=my-project,argusai.run-id=current-run,argusai.created-at=2026-01-01T00:00:00Z`;
        }
        if (args.includes('inspect')) return '0';
        if (args.includes('rm')) return '';
        return '';
      });

      const cleaner = new OrphanCleaner('my-project', 'current-run');
      const result = await cleaner.detectAndCleanup();

      expect(result.found).toHaveLength(0);
      expect(result.removed).toHaveLength(1);
      expect(result.removed[0]!.type).toBe('network');
      expect(result.removed[0]!.name).toBe('argusai-stale-network');
    });
  });
});

// =================================================================
// removeEmptyManagedNetworks (issue #11)
// =================================================================

describe('removeEmptyManagedNetworks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function netLsOutput(...entries: Array<{ id: string; name: string; labels: string }>): string {
    return entries.map(e => `${e.id}\t${e.name}\t${e.labels}`).join('\n');
  }

  const oldLabels = 'argusai.managed=true,argusai.project=p,argusai.run-id=r1,argusai.created-at=2026-01-01T00:00:00Z';
  const freshLabels = `argusai.managed=true,argusai.project=p,argusai.run-id=r1,argusai.created-at=${new Date().toISOString()}`;

  it('should remove managed networks with no containers attached', async () => {
    mockDockerExec.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) return netLsOutput({ id: 'n1', name: 'argusai-p-network', labels: oldLabels });
      if (args.includes('inspect')) return '0';
      return '';
    });

    const result = await removeEmptyManagedNetworks({ project: 'p' });

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.name).toBe('argusai-p-network');
    expect(result.removed[0]!.project).toBe('p');
    expect(result.skipped).toHaveLength(0);
    expect(mockDockerExec).toHaveBeenCalledWith(expect.arrayContaining(['network', 'rm', 'argusai-p-network']));
  });

  it('should skip networks that still have containers', async () => {
    mockDockerExec.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) return netLsOutput({ id: 'n1', name: 'argusai-p-network', labels: oldLabels });
      if (args.includes('inspect')) return '2';
      return '';
    });

    const result = await removeEmptyManagedNetworks({ project: 'p' });

    expect(result.removed).toHaveLength(0);
    expect(result.skipped).toEqual(['argusai-p-network']);
  });

  it('should skip networks younger than the grace period', async () => {
    mockDockerExec.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) return netLsOutput({ id: 'n1', name: 'argusai-p-network', labels: freshLabels });
      return '';
    });

    const result = await removeEmptyManagedNetworks({ project: 'p', graceMs: 60_000 });

    expect(result.removed).toHaveLength(0);
    expect(result.skipped).toEqual(['argusai-p-network']);
  });

  it('should remove label-less empty networks (created before labels existed)', async () => {
    mockDockerExec.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) return netLsOutput({ id: 'n1', name: 'argusai-legacy-network', labels: '' });
      if (args.includes('inspect')) return '0';
      return '';
    });

    const result = await removeEmptyManagedNetworks();

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.name).toBe('argusai-legacy-network');
    expect(result.removed[0]!.project).toBe('unknown');
  });

  it('should scope the sweep by project label when given', async () => {
    mockDockerExec.mockResolvedValue('');

    await removeEmptyManagedNetworks({ project: 'my-project' });

    const lsCall = mockDockerExec.mock.calls.find(c => c[0]!.includes('ls'));
    expect(lsCall).toBeDefined();
    expect(lsCall![0]).toContain('label=argusai.project=my-project');
  });

  it('should treat inspect failures as non-empty and skip the network', async () => {
    mockDockerExec.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) return netLsOutput({ id: 'n1', name: 'argusai-p-network', labels: oldLabels });
      if (args.includes('inspect')) throw new Error('inspect failed');
      return '';
    });

    const result = await removeEmptyManagedNetworks({ project: 'p' });

    expect(result.removed).toHaveLength(0);
    expect(result.skipped).toEqual(['argusai-p-network']);
  });

  it('should return an empty result when docker is unreachable', async () => {
    mockDockerExec.mockRejectedValue(new Error('Docker not available'));

    const result = await removeEmptyManagedNetworks();

    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('should report removal failures per network', async () => {
    mockDockerExec.mockImplementation(async (args: string[]) => {
      if (args.includes('ls')) return netLsOutput({ id: 'n1', name: 'argusai-p-network', labels: oldLabels });
      if (args.includes('inspect')) return '0';
      if (args.includes('rm')) throw new Error('removal denied');
      return '';
    });

    const result = await removeEmptyManagedNetworks({ project: 'p' });

    expect(result.removed).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.name).toBe('argusai-p-network');
    expect(result.failed[0]!.error).toContain('removal denied');
  });
});
