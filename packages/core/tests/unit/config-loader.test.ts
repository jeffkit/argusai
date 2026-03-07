/**
 * Unit tests for config-loader module.
 *
 * Tests cover:
 * - Valid configuration loading
 * - Default value population
 * - .env file loading
 * - Variable substitution
 * - Invalid configuration error reporting
 * - File-not-found error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, E2EConfigSchema } from '../../src/config-loader.js';

/** Helper to create a temporary directory */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'e2e-config-test-'));
}

/** Minimal valid YAML config */
function minimalYaml(): string {
  return [
    'version: "1"',
    'project:',
    '  name: test-project',
    'service:',
    '  build:',
    '    dockerfile: Dockerfile',
    '    context: "."',
    '    image: test-image:latest',
    '  container:',
    '    name: test-container',
    '    ports:',
    '      - "8080:3000"',
  ].join('\n');
}

/** Full YAML config with all optional fields */
function fullYaml(): string {
  return [
    'version: "1"',
    'project:',
    '  name: full-project',
    '  description: A fully configured project',
    'service:',
    '  build:',
    '    dockerfile: Dockerfile.prod',
    '    context: "./app"',
    '    image: "my-app:{{config.app_version}}"',
    '    args:',
    '      NODE_ENV: production',
    '  container:',
    '    name: my-app-container',
    '    ports:',
    '      - "19000:3000"',
    '      - "19001:3001"',
    '    environment:',
    '      NODE_ENV: production',
    '      API_KEY: "{{env.TEST_API_KEY}}"',
    '    volumes:',
    '      - "./data:/app/data"',
    '    healthcheck:',
    '      path: /health',
    '      interval: "5s"',
    '      timeout: "3s"',
    '      retries: 5',
    '      startPeriod: "10s"',
    '  vars:',
    '    app_version: "2.0.0"',
    '    base_url: "http://localhost:19000"',
    'mocks:',
    '  gateway:',
    '    port: 8081',
    '    containerPort: 3001',
    '    routes:',
    '      - method: GET',
    '        path: /api/status',
    '        response:',
    '          status: 200',
    '          body:',
    '            status: ok',
    'tests:',
    '  suites:',
    '    - name: Health Check',
    '      id: health',
    '      file: tests/health.yaml',
    '      runner: yaml',
    'dashboard:',
    '  port: 9095',
    '  uiPort: 9091',
    'network:',
    '  name: test-network',
  ].join('\n');
}

describe('config-loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('E2EConfigSchema', () => {
    it('should validate a minimal configuration', () => {
      const result = E2EConfigSchema.safeParse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: { name: 'test', ports: ['8080:3000'] },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('1');
        expect(result.data.project.name).toBe('test');
      }
    });

    it('should apply default values', () => {
      const result = E2EConfigSchema.parse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: { name: 'test', ports: ['8080:3000'] },
        },
      });
      expect(result.version).toBe('1');
      expect(result.service.build.context).toBe('.');
    });

    it('should reject missing required fields', () => {
      const result = E2EConfigSchema.safeParse({ version: '1' });
      expect(result.success).toBe(false);
    });

    it('should validate healthcheck with defaults', () => {
      const result = E2EConfigSchema.parse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: {
            name: 'test',
            ports: ['8080:3000'],
            healthcheck: { path: '/health' },
          },
        },
      });
      const hc = result.service.container.healthcheck;
      expect(hc).toBeDefined();
      expect(hc!.interval).toBe('10s');
      expect(hc!.timeout).toBe('5s');
      expect(hc!.retries).toBe(10);
      expect(hc!.startPeriod).toBe('30s');
    });

    it('should validate dashboard with defaults', () => {
      const result = E2EConfigSchema.parse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: { name: 'test', ports: ['8080:3000'] },
        },
        dashboard: {},
      });
      expect(result.dashboard!.port).toBe(9095);
      expect(result.dashboard!.uiPort).toBe(9091);
    });

    it('should validate network with defaults', () => {
      const result = E2EConfigSchema.parse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: { name: 'test', ports: ['8080:3000'] },
        },
        network: {},
      });
      expect(result.network!.name).toBe('e2e-network');
    });
  });

  describe('loadConfig', () => {
    it('should load a valid YAML config file', async () => {
      const configPath = path.join(tmpDir, 'e2e.yaml');
      await fs.writeFile(configPath, minimalYaml(), 'utf-8');

      const config = await loadConfig(configPath);
      expect(config.project.name).toBe('test-project');
      expect(config.service!.build.dockerfile).toBe(path.resolve(tmpDir, 'Dockerfile'));
      expect(config.service!.container.ports).toEqual(['8080:3000']);
    });

    it('should load a full config with all optional fields', async () => {
      const configPath = path.join(tmpDir, 'e2e.yaml');
      const envPath = path.join(tmpDir, '.env');
      await fs.writeFile(configPath, fullYaml(), 'utf-8');
      await fs.writeFile(envPath, 'TEST_API_KEY=secret-key-123\n', 'utf-8');

      const config = await loadConfig(configPath);
      expect(config.project.description).toBe('A fully configured project');
      expect(config.service.build.image).toBe('my-app:2.0.0');
      expect(config.service.container.environment!['API_KEY']).toBe('secret-key-123');
      expect(config.mocks).toBeDefined();
      expect(config.mocks!['gateway']).toBeDefined();
      expect(config.tests).toBeDefined();
      expect(config.dashboard).toBeDefined();
      expect(config.network!.name).toBe('test-network');
    });

    it('should populate default values in loaded config', async () => {
      const configPath = path.join(tmpDir, 'e2e.yaml');
      await fs.writeFile(configPath, minimalYaml(), 'utf-8');

      const config = await loadConfig(configPath);
      expect(config.version).toBe('1');
      expect(config.service!.build.context).toBe(path.resolve(tmpDir, '.'));
    });

    it('should load .env file from the config directory', async () => {
      const configContent = [
        'version: "1"',
        'project:',
        '  name: env-test',
        'service:',
        '  build:',
        '    dockerfile: Dockerfile',
        '    image: test:latest',
        '  container:',
        '    name: test',
        '    ports:',
        '      - "8080:3000"',
        '    environment:',
        '      MY_VAR: "{{env.MY_TEST_VAR}}"',
      ].join('\n');

      await fs.writeFile(path.join(tmpDir, '.env'), 'MY_TEST_VAR=hello-world\n', 'utf-8');
      await fs.writeFile(path.join(tmpDir, 'e2e.yaml'), configContent, 'utf-8');

      const config = await loadConfig(path.join(tmpDir, 'e2e.yaml'));
      expect(config.service.container.environment!['MY_VAR']).toBe('hello-world');
    });

    it('should resolve config variables ({{config.xxx}})', async () => {
      const configContent = [
        'version: "1"',
        'project:',
        '  name: var-test',
        'service:',
        '  build:',
        '    dockerfile: Dockerfile',
        '    image: "app:{{config.version}}"',
        '  container:',
        '    name: test',
        '    ports:',
        '      - "8080:3000"',
        '  vars:',
        '    version: "3.5.1"',
      ].join('\n');

      await fs.writeFile(path.join(tmpDir, 'e2e.yaml'), configContent, 'utf-8');

      const config = await loadConfig(path.join(tmpDir, 'e2e.yaml'));
      expect(config.service.build.image).toBe('app:3.5.1');
    });

    it('should throw on file not found', async () => {
      await expect(
        loadConfig(path.join(tmpDir, 'nonexistent.yaml')),
      ).rejects.toThrow('Configuration file not found');
    });

    it('should throw on YAML syntax error', async () => {
      const configPath = path.join(tmpDir, 'bad.yaml');
      await fs.writeFile(configPath, ':\n  invalid: yaml\n    broken:', 'utf-8');

      await expect(loadConfig(configPath)).rejects.toThrow('YAML syntax error');
    });

    it('should throw on Zod validation error with readable messages', async () => {
      const configContent = [
        'version: "1"',
        'project:',
        '  name: test',
        'service:',
        '  build:',
        '    dockerfile: Dockerfile',
        '    image: test:latest',
        '  container:',
        '    name: test',
        '    ports: "not-an-array"',
      ].join('\n');

      const configPath = path.join(tmpDir, 'invalid.yaml');
      await fs.writeFile(configPath, configContent, 'utf-8');

      await expect(loadConfig(configPath)).rejects.toThrow(
        'Configuration validation failed',
      );
    });

    it('should throw on empty config file', async () => {
      const configPath = path.join(tmpDir, 'empty.yaml');
      await fs.writeFile(configPath, '', 'utf-8');

      await expect(loadConfig(configPath)).rejects.toThrow(
        'empty or not a valid object',
      );
    });

    it('should auto-discover e2e.yaml in cwd', async () => {
      await fs.writeFile(path.join(tmpDir, 'e2e.yaml'), minimalYaml(), 'utf-8');

      const originalCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        const config = await loadConfig();
        expect(config.project.name).toBe('test-project');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should auto-discover e2e.yml as fallback', async () => {
      await fs.writeFile(path.join(tmpDir, 'e2e.yml'), minimalYaml(), 'utf-8');

      const originalCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        const config = await loadConfig();
        expect(config.project.name).toBe('test-project');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should throw when no config file found in cwd', async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        await expect(loadConfig()).rejects.toThrow('Configuration file not found');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should resolve build paths to absolute (relative to config dir)', async () => {
      const configPath = path.join(tmpDir, 'e2e.yaml');
      await fs.writeFile(configPath, minimalYaml(), 'utf-8');

      const config = await loadConfig(configPath);
      expect(path.isAbsolute(config.service!.build.dockerfile)).toBe(true);
      expect(path.isAbsolute(config.service!.build.context)).toBe(true);
      expect(config.service!.build.dockerfile).toBe(path.resolve(tmpDir, 'Dockerfile'));
      expect(config.service!.build.context).toBe(path.resolve(tmpDir, '.'));
    });

    it('should resolve build paths for multi-service config', async () => {
      const configContent = [
        'version: "1"',
        'project:',
        '  name: multi-svc',
        'services:',
        '  - name: backend',
        '    build:',
        '      dockerfile: docker/Dockerfile.backend',
        '      context: "."',
        '      image: backend:latest',
        '    container:',
        '      name: backend',
        '      ports:',
        '        - "8080:8080"',
        '  - name: frontend',
        '    build:',
        '      dockerfile: docker/Dockerfile.frontend',
        '      context: "./frontend"',
        '      image: frontend:latest',
        '    container:',
        '      name: frontend',
        '      ports:',
        '        - "3000:3000"',
      ].join('\n');
      const configPath = path.join(tmpDir, 'e2e.yaml');
      await fs.writeFile(configPath, configContent, 'utf-8');

      const config = await loadConfig(configPath);
      expect(config.services).toHaveLength(2);
      expect(config.services![0]!.build.dockerfile).toBe(path.resolve(tmpDir, 'docker/Dockerfile.backend'));
      expect(config.services![0]!.build.context).toBe(path.resolve(tmpDir, '.'));
      expect(config.services![1]!.build.context).toBe(path.resolve(tmpDir, './frontend'));
    });

    it('should accept services in object format (docker-compose style)', async () => {
      const configContent = [
        'version: "1"',
        'project:',
        '  name: object-services',
        'services:',
        '  backend:',
        '    build:',
        '      dockerfile: Dockerfile',
        '      context: "."',
        '      image: backend:latest',
        '    container:',
        '      name: backend-app',
        '      ports:',
        '        - "8080:8080"',
        '  redis:',
        '    build:',
        '      dockerfile: Dockerfile.redis',
        '      context: "."',
        '      image: redis:latest',
        '    container:',
        '      name: redis-cache',
        '      ports:',
        '        - "6379:6379"',
      ].join('\n');
      const configPath = path.join(tmpDir, 'e2e.yaml');
      await fs.writeFile(configPath, configContent, 'utf-8');

      const config = await loadConfig(configPath);
      expect(config.services).toHaveLength(2);
      expect(config.services![0]!.name).toBe('backend');
      expect(config.services![1]!.name).toBe('redis');
    });
  });

  describe('HealthcheckSchema', () => {
    it('should accept optional port field', () => {
      const result = E2EConfigSchema.parse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: {
            name: 'test',
            ports: ['8080:3000'],
            healthcheck: { path: '/health', port: 8080 },
          },
        },
      });
      expect(result.service!.container.healthcheck!.port).toBe(8080);
    });

    it('should work without port field (backward compatible)', () => {
      const result = E2EConfigSchema.parse({
        project: { name: 'test' },
        service: {
          build: { dockerfile: 'Dockerfile', image: 'test:latest' },
          container: {
            name: 'test',
            ports: ['8080:3000'],
            healthcheck: { path: '/health' },
          },
        },
      });
      expect(result.service!.container.healthcheck!.port).toBeUndefined();
    });
  });
});
