/**
 * CLI smoke tests for ArgusAI.
 *
 * Tests cover:
 * - --help output (all 25 commands)
 * - --version output
 * - init command generates files (uses temporary directory)
 * - Each new command's --help shows correct options
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Run the CLI via tsx */
function runCLI(args: string[], cwd?: string): string {
  const cliPath = path.resolve(__dirname, '../src/index.ts');
  return execFileSync('npx', ['tsx', cliPath, ...args], {
    encoding: 'utf-8',
    cwd,
    timeout: 15_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

/** Run CLI expecting non-zero exit; returns stderr + stdout combined */
function runCLIExpectFail(args: string[], cwd?: string): string {
  const cliPath = path.resolve(__dirname, '../src/index.ts');
  try {
    execFileSync('npx', ['tsx', cliPath, ...args], {
      encoding: 'utf-8',
      cwd,
      timeout: 15_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    throw new Error('Expected CLI to fail but it succeeded');
  } catch (err: any) {
    return (err.stdout ?? '') + (err.stderr ?? '');
  }
}

const ALL_COMMANDS = [
  'init', 'setup', 'run', 'build', 'status', 'clean',
  'dashboard', 'logs', 'mcp-server', 'server',
  'history', 'flaky', 'diagnose', 'trends', 'compare',
  'patterns', 'dev', 'rebuild', 'resources', 'preflight',
  'mock-requests', 'mock-generate', 'mock-validate',
  'report-fix', 'reset-circuit',
];

describe('CLI', () => {
  describe('--help', () => {
    it('should show help text with all 25 commands', () => {
      const output = runCLI(['--help']);
      expect(output).toContain('argusai');
      for (const cmd of ALL_COMMANDS) {
        expect(output).toContain(cmd);
      }
    });
  });

  describe('--version', () => {
    it('should show version number', () => {
      const output = runCLI(['--version']);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('init', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-cli-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should create project files in target directory', async () => {
      runCLI(['init', '--dir', tmpDir]);

      await expect(fs.stat(path.join(tmpDir, 'e2e.yaml'))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(tmpDir, 'tests', 'health.yaml'))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(tmpDir, '.env.example'))).resolves.toBeTruthy();
    });

    it('should not overwrite existing files', async () => {
      const customContent = 'custom-content';
      await fs.writeFile(path.join(tmpDir, 'e2e.yaml'), customContent, 'utf-8');

      runCLI(['init', '--dir', tmpDir]);

      const content = await fs.readFile(path.join(tmpDir, 'e2e.yaml'), 'utf-8');
      expect(content).toBe(customContent);
    });
  });

  describe('new command --help', () => {
    const NEW_COMMANDS_WITH_OPTIONS: Array<[string, string[]]> = [
      ['history', ['--limit', '--status', '--days']],
      ['flaky', ['--top', '--min-score', '--suite']],
      ['diagnose', ['--run', '--case']],
      ['trends', ['--metric', '--days', '--suite']],
      ['compare', ['--base', '--target']],
      ['patterns', ['--category', '--source', '--sort']],
      ['dev', ['--no-cache', '--skip-build']],
      ['rebuild', ['--no-cache']],
      ['preflight', ['--skip-disk', '--skip-orphans', '--auto-fix']],
      ['mock-requests', ['--mock', '--clear']],
      ['mock-generate', ['--spec', '--name', '--port']],
      ['mock-validate', ['--mock', '--spec']],
      ['report-fix', ['--run', '--case', '--fix']],
    ];

    for (const [cmd, expectedOptions] of NEW_COMMANDS_WITH_OPTIONS) {
      it(`${cmd} --help should show expected options`, () => {
        const output = runCLI([cmd, '--help']);
        for (const opt of expectedOptions) {
          expect(output).toContain(opt);
        }
      });
    }

    it('resources --help should show description', () => {
      const output = runCLI(['resources', '--help']);
      expect(output).toContain('Docker');
    });

    it('reset-circuit --help should show description', () => {
      const output = runCLI(['reset-circuit', '--help']);
      expect(output).toContain('熔断');
    });
  });
});
