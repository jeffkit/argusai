/**
 * Unit tests for docker-engine module.
 *
 * Tests focus on command-building logic (no real Docker daemon required).
 * Integration tests that require Docker should be in a separate file.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildBuildArgs,
  buildRunArgs,
  buildImage,
  isPortInUse,
  isPortInUseSync,
  type DockerBuildOptions,
  type DockerRunOptions,
} from '../../src/docker-engine.js';
import { createServer } from 'node:net';

describe('docker-engine', () => {
  describe('buildBuildArgs', () => {
    it('should generate minimal build args', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile',
        context: '.',
        imageName: 'my-app:latest',
      };

      const args = buildBuildArgs(options);

      expect(args).toEqual([
        'build',
        '-f', 'Dockerfile',
        '-t', 'my-app:latest',
        '.',
      ]);
    });

    it('should include --no-cache when specified', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile',
        context: '.',
        imageName: 'test:v1',
        noCache: true,
      };

      const args = buildBuildArgs(options);

      expect(args).toContain('--no-cache');
      expect(args.indexOf('--no-cache')).toBeLessThan(args.indexOf('.'));
    });

    it('should include build args', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile.prod',
        context: './app',
        imageName: 'prod-app:2.0',
        buildArgs: {
          NODE_ENV: 'production',
          VERSION: '2.0.0',
        },
      };

      const args = buildBuildArgs(options);

      expect(args).toContain('--build-arg');
      expect(args).toContain('NODE_ENV=production');
      expect(args).toContain('VERSION=2.0.0');
    });

    it('should use custom dockerfile path', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'docker/Dockerfile.dev',
        context: '../',
        imageName: 'dev:latest',
      };

      const args = buildBuildArgs(options);

      expect(args[1]).toBe('-f');
      expect(args[2]).toBe('docker/Dockerfile.dev');
      expect(args[args.length - 1]).toBe('../');
    });

    it('should place context as the last argument', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile',
        context: '/path/to/context',
        imageName: 'test:latest',
        noCache: true,
        buildArgs: { FOO: 'bar' },
      };

      const args = buildBuildArgs(options);

      expect(args[args.length - 1]).toBe('/path/to/context');
    });
  });

  describe('buildRunArgs', () => {
    it('should generate minimal run args', () => {
      const options: DockerRunOptions = {
        name: 'test-container',
        image: 'my-app:latest',
        ports: ['8080:3000'],
      };

      const args = buildRunArgs(options);

      expect(args).toEqual([
        'run', '-d',
        '--name', 'test-container',
        '-p', '8080:3000',
        'my-app:latest',
      ]);
    });

    it('should include network option', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        network: 'e2e-network',
      };

      const args = buildRunArgs(options);

      expect(args).toContain('--network');
      expect(args).toContain('e2e-network');
      // Network should come before ports
      const networkIdx = args.indexOf('--network');
      const portIdx = args.indexOf('-p');
      expect(networkIdx).toBeLessThan(portIdx);
    });

    it('should include multiple port mappings', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000', '8081:3001', '9090:9090'],
      };

      const args = buildRunArgs(options);

      const portFlags = args.filter((a) => a === '-p');
      expect(portFlags).toHaveLength(3);
      expect(args).toContain('8080:3000');
      expect(args).toContain('8081:3001');
      expect(args).toContain('9090:9090');
    });

    it('should include environment variables', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        environment: {
          NODE_ENV: 'production',
          API_KEY: 'secret',
        },
      };

      const args = buildRunArgs(options);

      expect(args).toContain('-e');
      expect(args).toContain('NODE_ENV=production');
      expect(args).toContain('API_KEY=secret');
    });

    it('should include volume mounts', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        volumes: ['./data:/app/data', 'cache-vol:/cache'],
      };

      const args = buildRunArgs(options);

      expect(args).toContain('-v');
      expect(args).toContain('./data:/app/data');
      expect(args).toContain('cache-vol:/cache');
    });

    it('should include healthcheck options', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        healthcheck: {
          cmd: 'curl -f http://localhost:3000/health || exit 1',
          interval: '10s',
          timeout: '5s',
          retries: 3,
          startPeriod: '30s',
        },
      };

      const args = buildRunArgs(options);

      expect(args).toContain('--health-cmd');
      expect(args).toContain('curl -f http://localhost:3000/health || exit 1');
      expect(args).toContain('--health-interval');
      expect(args).toContain('10s');
      expect(args).toContain('--health-timeout');
      expect(args).toContain('5s');
      expect(args).toContain('--health-retries');
      expect(args).toContain('3');
      expect(args).toContain('--health-start-period');
      expect(args).toContain('30s');
    });

    it('should place image name as the last argument', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'my-custom-image:v2.0',
        ports: ['8080:3000'],
        network: 'net',
        environment: { A: 'B' },
        volumes: ['v:/v'],
        healthcheck: {
          cmd: 'true',
          interval: '5s',
          timeout: '3s',
          retries: 1,
          startPeriod: '10s',
        },
      };

      const args = buildRunArgs(options);

      expect(args[args.length - 1]).toBe('my-custom-image:v2.0');
    });

    it('should generate correct order: run -d --name NAME [--network] [-p] [-e] [-v] [--health-*] IMAGE', () => {
      const options: DockerRunOptions = {
        name: 'ordered-test',
        image: 'ordered-image:latest',
        ports: ['80:80'],
        network: 'my-net',
        environment: { FOO: 'bar' },
        volumes: ['/host:/container'],
      };

      const args = buildRunArgs(options);

      expect(args[0]).toBe('run');
      expect(args[1]).toBe('-d');
      expect(args[2]).toBe('--name');
      expect(args[3]).toBe('ordered-test');

      // Network comes after name
      const networkIdx = args.indexOf('--network');
      expect(networkIdx).toBeGreaterThan(3);

      // Image is last
      expect(args[args.length - 1]).toBe('ordered-image:latest');
    });
  });

  describe('isPortInUseSync', () => {
    it('should return a boolean', () => {
      const result = isPortInUseSync(99999);
      expect(typeof result).toBe('boolean');
    });

    it('should detect a well-known unused high port as free', () => {
      const result = isPortInUseSync(59123);
      expect(typeof result).toBe('boolean');
    });
  });

  // ── Regression: T014 — buildImage event capture ─────────────────────
  describe('buildImage (regression: event capture)', () => {
    it('should use the queue-based pattern that yields build_log events', async () => {
      const source = await import('node:fs/promises')
        .then(fs => fs.readFile(
          new URL('../../src/docker-engine.ts', import.meta.url).pathname,
          'utf-8',
        ));

      const buildImageMatch = source.match(
        /export async function\* buildImage[\s\S]*?^}/m,
      );
      expect(buildImageMatch).toBeTruthy();
      const buildImageSrc = buildImageMatch![0];

      // Captures build_log events and bridges emitter callbacks via the
      // promise-based AsyncEventQueue (no busy-polling timeout).
      expect(buildImageSrc).toContain('build_log');
      expect(buildImageSrc).toContain('AsyncEventQueue');
      expect(buildImageSrc).toContain('queue.stream()');
      expect(buildImageSrc).not.toContain('setTimeout(resolve, 1000)');
      expect(buildImageSrc).not.toContain("We can't yield from inside a callback");
    });

    it('should export buildImageStreaming as alias for backward compatibility', async () => {
      const mod = await import('../../src/docker-engine.js');
      expect(mod.buildImageStreaming).toBe(mod.buildImage);
    });
  });

  // ── Regression: T015 — command injection prevention ─────────────────
  describe('command injection prevention (regression)', () => {
    it('should use execFileSync not execSync in buildRunArgs for container names with metacharacters', () => {
      const options: DockerRunOptions = {
        name: 'test; rm -rf /',
        image: 'app:latest',
        ports: ['8080:3000'],
        environment: { 'FOO': '$(whoami)' },
      };
      const args = buildRunArgs(options);
      expect(args).toContain('test; rm -rf /');
      expect(args).toContain('FOO=$(whoami)');
    });

    it('should not import execSync from child_process', async () => {
      const source = await import('node:fs/promises')
        .then(fs => fs.readFile(
          new URL('../../src/docker-engine.ts', import.meta.url).pathname,
          'utf-8',
        ));
      expect(source).not.toMatch(/\bimport\b.*\bexecSync\b.*from/);
      expect(source).toMatch(/\bexecFileSync\b/);
    });
  });

  // ── Regression: T016 — isPortInUse async detection ──────────────────
  describe('isPortInUse (regression: async detection)', () => {
    it('should return true for a port in use', async () => {
      const server = createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') resolve(addr.port);
          else reject(new Error('Failed to get port'));
        });
      });

      try {
        const result = await isPortInUse(port);
        expect(result).toBe(true);
      } finally {
        server.close();
      }
    });

    it('should return false for a free port', async () => {
      const server = createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') resolve(addr.port);
          else reject(new Error('Failed to get port'));
        });
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));

      const result = await isPortInUse(port);
      expect(result).toBe(false);
    });
  });
});
