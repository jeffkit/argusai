/**
 * Unit tests for resilience/port-resolver module.
 *
 * Mocks docker-engine.isPortInUse and child_process for lsof.
 * Covers: findAvailablePort, resolveServicePorts (auto/fail), port exhaustion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServiceDefinition, MockServiceConfig, SSEBus, SSEMessage } from '../../../src/types.js';

vi.mock('../../../src/docker-engine.js', () => ({
  isPortInUse: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (_bin: string, _args: string[], _opts: unknown, callback?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (typeof _opts === 'function') {
        callback = _opts as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      }
      callback?.(new Error('lsof not available'), { stdout: '', stderr: '' });
    },
  ),
}));

import { isPortInUse } from '../../../src/docker-engine.js';
import { PortResolver } from '../../../src/resilience/port-resolver.js';
import { ArgusError } from '../../../src/resilience/error-codes.js';

const mockIsPortInUse = vi.mocked(isPortInUse);

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

describe('PortResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =================================================================
  // findAvailablePort
  // =================================================================

  describe('findAvailablePort', () => {
    it('should return the start port when it is available', async () => {
      mockIsPortInUse.mockResolvedValue(false);

      const resolver = new PortResolver('auto');
      const port = await resolver.findAvailablePort(3000);

      expect(port).toBe(3000);
    });

    it('should skip occupied ports and return next available', async () => {
      mockIsPortInUse
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const resolver = new PortResolver('auto');
      const port = await resolver.findAvailablePort(3000);

      expect(port).toBe(3002);
    });

    it('should skip privileged ports (< 1024)', async () => {
      mockIsPortInUse.mockResolvedValue(false);

      const resolver = new PortResolver('auto');
      const port = await resolver.findAvailablePort(80);

      expect(port).toBe(1024);
    });

    it('should throw PORT_EXHAUSTION when no port is available', async () => {
      mockIsPortInUse.mockResolvedValue(true);

      const resolver = new PortResolver('auto');

      await expect(
        resolver.findAvailablePort(60000, 10),
      ).rejects.toThrow(ArgusError);

      try {
        await resolver.findAvailablePort(60000, 10);
      } catch (err) {
        expect((err as ArgusError).code).toBe('PORT_EXHAUSTION');
      }
    });
  });

  // =================================================================
  // resolveServicePorts - auto strategy
  // =================================================================

  describe('resolveServicePorts (auto)', () => {
    it('should pass through ports that are not in use', async () => {
      mockIsPortInUse.mockResolvedValue(false);

      const services: ServiceDefinition[] = [{
        name: 'api',
        build: { dockerfile: 'Dockerfile', context: '.', image: 'api:latest' },
        container: { name: 'api', ports: ['3000:3000'] },
      }];

      const resolver = new PortResolver('auto');
      const result = await resolver.resolveServicePorts(services, {});

      expect(result.services[0]!.container.ports[0]).toBe('3000:3000');
      expect(result.portMappings[0]!.reassigned).toBe(false);
    });

    it('should pass through port 0 unchanged (Docker random host port)', async () => {
      mockIsPortInUse.mockResolvedValue(false);

      const services: ServiceDefinition[] = [{
        name: 'api',
        build: { dockerfile: 'Dockerfile', context: '.', image: 'api:latest' },
        container: { name: 'api', ports: ['0:8080'] },
      }];

      const resolver = new PortResolver('auto');
      const result = await resolver.resolveServicePorts(services, {});

      expect(result.services[0]!.container.ports[0]).toBe('0:8080');
      expect(result.portMappings[0]!.originalPort).toBe(0);
      expect(result.portMappings[0]!.actualPort).toBe(0);
      expect(result.portMappings[0]!.reassigned).toBe(false);
    });

    it('should auto-reassign occupied service ports', async () => {
      mockIsPortInUse
        .mockResolvedValueOnce(true)   // 3000 is in use
        .mockResolvedValueOnce(false); // 3001 is free

      const services: ServiceDefinition[] = [{
        name: 'api',
        build: { dockerfile: 'Dockerfile', context: '.', image: 'api:latest' },
        container: { name: 'api', ports: ['3000:3000'] },
      }];

      const bus = createMockBus();
      const resolver = new PortResolver('auto', bus);
      const result = await resolver.resolveServicePorts(services, {});

      expect(result.services[0]!.container.ports[0]).toBe('3001:3000');
      expect(result.portMappings[0]!.reassigned).toBe(true);
      expect(result.portMappings[0]!.actualPort).toBe(3001);

      const conflictEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'port_conflict',
      );
      expect(conflictEvents.length).toBe(1);

      const reassignedEvents = bus.events.filter(
        e => (e.msg as { event: string }).event === 'port_reassigned',
      );
      expect(reassignedEvents.length).toBe(1);
    });

    it('should resolve mock service ports', async () => {
      mockIsPortInUse
        .mockResolvedValueOnce(true)   // 8080 in use
        .mockResolvedValueOnce(false); // 8081 free

      const mocks: Record<string, MockServiceConfig> = {
        'payment-api': { port: 8080, routes: [] },
      };

      const resolver = new PortResolver('auto');
      const result = await resolver.resolveServicePorts([], mocks);

      expect(result.mocks['payment-api']!.port).toBe(8081);
      expect(result.portMappings[0]!.service).toBe('payment-api');
    });

    it('should handle multiple services with mixed conflicts', async () => {
      mockIsPortInUse
        .mockResolvedValueOnce(false)  // 3000 free
        .mockResolvedValueOnce(true)   // 4000 in use
        .mockResolvedValueOnce(false); // 4001 free

      const services: ServiceDefinition[] = [
        {
          name: 'frontend',
          build: { dockerfile: 'Dockerfile', context: '.', image: 'fe:latest' },
          container: { name: 'frontend', ports: ['3000:3000'] },
        },
        {
          name: 'backend',
          build: { dockerfile: 'Dockerfile', context: '.', image: 'be:latest' },
          container: { name: 'backend', ports: ['4000:4000'] },
        },
      ];

      const resolver = new PortResolver('auto');
      const result = await resolver.resolveServicePorts(services, {});

      expect(result.services[0]!.container.ports[0]).toBe('3000:3000');
      expect(result.services[1]!.container.ports[0]).toBe('4001:4000');
      expect(result.portMappings).toHaveLength(2);
    });
  });

  // =================================================================
  // resolveServicePorts - fail strategy
  // =================================================================

  describe('resolveServicePorts (fail)', () => {
    it('should throw PORT_CONFLICT when port is in use', async () => {
      mockIsPortInUse.mockResolvedValue(true);

      const services: ServiceDefinition[] = [{
        name: 'api',
        build: { dockerfile: 'Dockerfile', context: '.', image: 'api:latest' },
        container: { name: 'api', ports: ['3000:3000'] },
      }];

      const resolver = new PortResolver('fail');

      await expect(
        resolver.resolveServicePorts(services, {}),
      ).rejects.toThrow(ArgusError);

      try {
        await resolver.resolveServicePorts(services, {});
      } catch (err) {
        expect((err as ArgusError).code).toBe('PORT_CONFLICT');
      }
    });

    it('should pass through when ports are free', async () => {
      mockIsPortInUse.mockResolvedValue(false);

      const services: ServiceDefinition[] = [{
        name: 'api',
        build: { dockerfile: 'Dockerfile', context: '.', image: 'api:latest' },
        container: { name: 'api', ports: ['3000:3000'] },
      }];

      const resolver = new PortResolver('fail');
      const result = await resolver.resolveServicePorts(services, {});

      expect(result.services[0]!.container.ports[0]).toBe('3000:3000');
    });
  });
});
