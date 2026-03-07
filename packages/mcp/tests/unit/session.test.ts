/**
 * Unit tests for SessionManager.
 * Tests create, get, remove, state transitions, and concurrent sessions.
 */

import { describe, it, expect } from 'vitest';
import { SessionManager, SessionError } from '../../src/session.js';
import type { E2EConfig } from 'argusai-core';

function makeConfig(name = 'test-project'): E2EConfig {
  return {
    version: '1',
    project: { name },
    service: {
      build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
      container: { name: 'test-container', ports: ['3000:3000'] },
    },
    network: { name: 'test-net' },
  };
}

describe('SessionManager', () => {
  describe('create', () => {
    it('should create a new session', () => {
      const manager = new SessionManager();
      const config = makeConfig();
      const session = manager.create('/project/a', config, '/project/a/e2e.yaml');

      expect(session.projectPath).toBe('/project/a');
      expect(session.config).toBe(config);
      expect(session.configPath).toBe('/project/a/e2e.yaml');
      expect(session.state).toBe('initialized');
      expect(session.networkName).toBe('test-net');
      expect(session.containerIds.size).toBe(0);
      expect(session.mockServers.size).toBe(0);
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it('should throw SESSION_EXISTS for duplicate sessions', () => {
      const manager = new SessionManager();
      const config = makeConfig();
      manager.create('/project/a', config, '/project/a/e2e.yaml');

      expect(() => manager.create('/project/a', config, '/project/a/e2e.yaml'))
        .toThrow(SessionError);
    });

    it('should use default network name when not configured', () => {
      const manager = new SessionManager();
      const config: E2EConfig = {
        version: '1',
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', context: '.', image: 'test:latest' },
          container: { name: 'test', ports: [] },
        },
      };
      const session = manager.create('/project/b', config, '/project/b/e2e.yaml');

      expect(session.networkName).toBe('argusai-test-network');
    });
  });

  describe('getOrThrow', () => {
    it('should return existing session', () => {
      const manager = new SessionManager();
      const config = makeConfig();
      const created = manager.create('/project/a', config, '/path');

      const retrieved = manager.getOrThrow('/project/a');
      expect(retrieved).toBe(created);
    });

    it('should throw SESSION_NOT_FOUND for non-existent session', () => {
      const manager = new SessionManager();

      expect(() => manager.getOrThrow('/project/missing'))
        .toThrow(SessionError);

      try {
        manager.getOrThrow('/project/missing');
      } catch (err) {
        expect((err as SessionError).code).toBe('SESSION_NOT_FOUND');
      }
    });
  });

  describe('has', () => {
    it('should return true for existing session', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      expect(manager.has('/project/a')).toBe(true);
    });

    it('should return false for non-existent session', () => {
      const manager = new SessionManager();
      expect(manager.has('/project/x')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove an existing session', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      manager.remove('/project/a');

      expect(manager.has('/project/a')).toBe(false);
    });

    it('should not throw when removing non-existent session', () => {
      const manager = new SessionManager();
      expect(() => manager.remove('/project/missing')).not.toThrow();
    });
  });

  describe('state transitions', () => {
    it('should transition initialized → built', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      manager.transition('/project/a', 'built');

      expect(manager.getOrThrow('/project/a').state).toBe('built');
    });

    it('should transition built → running', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      manager.transition('/project/a', 'built');
      manager.transition('/project/a', 'running');

      expect(manager.getOrThrow('/project/a').state).toBe('running');
    });

    it('should transition running → stopped', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      manager.transition('/project/a', 'built');
      manager.transition('/project/a', 'running');
      manager.transition('/project/a', 'stopped');

      expect(manager.getOrThrow('/project/a').state).toBe('stopped');
    });

    it('should reject invalid transitions', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      manager.transition('/project/a', 'running');

      // running → initialized is not a valid transition
      expect(() => manager.transition('/project/a', 'initialized'))
        .toThrow(SessionError);

      try {
        manager.transition('/project/a', 'initialized');
      } catch (err) {
        expect((err as SessionError).code).toBe('INVALID_STATE');
      }
    });

    it('should allow initialized → stopped (skip)', () => {
      const manager = new SessionManager();
      manager.create('/project/a', makeConfig(), '/path');
      manager.transition('/project/a', 'stopped');

      expect(manager.getOrThrow('/project/a').state).toBe('stopped');
    });
  });

  describe('concurrent sessions', () => {
    it('should manage multiple independent sessions', () => {
      const manager = new SessionManager();
      const sessionA = manager.create('/project/a', makeConfig('project-a'), '/a');
      const sessionB = manager.create('/project/b', makeConfig('project-b'), '/b');

      expect(sessionA.config.project.name).toBe('project-a');
      expect(sessionB.config.project.name).toBe('project-b');

      manager.transition('/project/a', 'built');
      expect(manager.getOrThrow('/project/a').state).toBe('built');
      expect(manager.getOrThrow('/project/b').state).toBe('initialized');

      manager.remove('/project/a');
      expect(manager.has('/project/a')).toBe(false);
      expect(manager.has('/project/b')).toBe(true);
    });
  });
});
