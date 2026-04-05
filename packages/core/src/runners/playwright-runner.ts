/**
 * @module runners/playwright-runner
 * Playwright browser testing runner implementation.
 *
 * Implements the {@link TestRunner} interface by spawning
 * `npx playwright test --reporter=json` and parsing the structured
 * JSON output into a {@link TestEvent} stream.
 */

import { spawn } from 'node:child_process';
import type { TestRunner, RunConfig, TestEvent } from '../types.js';

/**
 * Playwright JSON reporter output structure (subset of fields we need).
 */
interface PlaywrightJsonReport {
  suites: PlaywrightSuite[];
  errors: Array<{ message: string }>;
}

interface PlaywrightSuite {
  title: string;
  suites?: PlaywrightSuite[];
  specs: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests: PlaywrightTest[];
}

interface PlaywrightTest {
  expectedStatus: string;
  status: string;
  results: PlaywrightResult[];
}

interface PlaywrightResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  error?: {
    message: string;
    stack?: string;
    snippet?: string;
  };
  attachments?: Array<{
    name: string;
    path?: string;
    contentType: string;
  }>;
}

/**
 * Playwright browser test runner.
 *
 * Executes Playwright tests via `npx playwright test --reporter=json`
 * in a child process, parses the JSON output, and produces standard
 * {@link TestEvent} entries for unified reporting.
 */
export class PlaywrightRunner implements TestRunner {
  id = 'playwright';

  /**
   * Execute Playwright tests and yield TestEvent entries.
   *
   * @param config - Run configuration
   * @yields {TestEvent} Test progress events
   */
  async *run(config: RunConfig): AsyncGenerator<TestEvent> {
    const suiteName = `playwright:${config.target || 'all'}`;
    const suiteStart = Date.now();

    yield { type: 'suite_start', suite: suiteName, timestamp: Date.now() };

    const args = ['playwright', 'test', '--reporter=json'];

    if (config.configFile) {
      args.push('--config', config.configFile);
    }

    if (config.target) {
      args.push(config.target);
    }

    let jsonOutput = '';
    let stderrOutput = '';

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn('npx', args, {
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: config.timeout,
      });

      proc.stdout.on('data', (data: Buffer) => {
        jsonOutput += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });

      proc.on('close', (code) => resolve(code ?? 1));
      proc.on('error', () => resolve(1));
    });

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    try {
      const report = JSON.parse(jsonOutput) as PlaywrightJsonReport;
      const events = this.parseReport(report, suiteName);

      for (const event of events) {
        if (event.type === 'case_pass') passed++;
        if (event.type === 'case_fail') failed++;
        if (event.type === 'case_skip') skipped++;
        yield event;
      }
    } catch {
      // JSON parsing failed — fallback to a single failure event
      if (exitCode !== 0) {
        failed++;
        const errorMessage = stderrOutput.trim() || `Playwright exited with code ${exitCode}`;
        yield {
          type: 'case_fail',
          suite: suiteName,
          name: 'playwright-process',
          error: errorMessage,
          duration: Date.now() - suiteStart,
          timestamp: Date.now(),
        };
      }
    }

    yield {
      type: 'suite_end',
      suite: suiteName,
      passed,
      failed,
      skipped,
      duration: Date.now() - suiteStart,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if Playwright is available by attempting to resolve @playwright/test.
   */
  async available(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn('npx', ['playwright', '--version'], {
        stdio: 'ignore',
        timeout: 10_000,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Parse Playwright JSON report into flat TestEvent array.
   */
  private parseReport(
    report: PlaywrightJsonReport,
    suiteName: string,
  ): TestEvent[] {
    const events: TestEvent[] = [];

    const walkSuites = (suites: PlaywrightSuite[], prefix: string) => {
      for (const suite of suites) {
        const fullName = prefix ? `${prefix} > ${suite.title}` : suite.title;

        for (const spec of suite.specs) {
          const caseName = `${fullName} > ${spec.title}`;

          events.push({
            type: 'case_start',
            suite: suiteName,
            name: caseName,
            timestamp: Date.now(),
          });

          for (const test of spec.tests) {
            const lastResult = test.results[test.results.length - 1];

            if (!lastResult || lastResult.status === 'skipped') {
              events.push({
                type: 'case_skip',
                suite: suiteName,
                name: caseName,
                reason: 'Skipped by Playwright',
                timestamp: Date.now(),
              });
            } else if (lastResult.status === 'passed') {
              events.push({
                type: 'case_pass',
                suite: suiteName,
                name: caseName,
                duration: lastResult.duration,
                timestamp: Date.now(),
              });
            } else {
              const error = this.formatError(lastResult);
              events.push({
                type: 'case_fail',
                suite: suiteName,
                name: caseName,
                error,
                duration: lastResult.duration,
                timestamp: Date.now(),
              });
            }
          }
        }

        if (suite.suites) {
          walkSuites(suite.suites, fullName);
        }
      }
    };

    walkSuites(report.suites, '');
    return events;
  }

  /**
   * Format a Playwright test result error with attachment paths
   * (screenshots, traces) if available.
   */
  private formatError(result: PlaywrightResult): string {
    const parts: string[] = [];

    if (result.error?.message) {
      parts.push(result.error.message);
    } else {
      parts.push(`Test ${result.status}`);
    }

    if (result.error?.snippet) {
      parts.push(`\nCode:\n${result.error.snippet}`);
    }

    const screenshots = result.attachments?.filter(
      a => a.contentType.startsWith('image/') && a.path,
    );
    if (screenshots && screenshots.length > 0) {
      parts.push(
        `\nScreenshots: ${screenshots.map(s => s.path).join(', ')}`,
      );
    }

    const traces = result.attachments?.filter(
      a => a.name === 'trace' && a.path,
    );
    if (traces && traces.length > 0) {
      parts.push(`\nTraces: ${traces.map(t => t.path).join(', ')}`);
    }

    return parts.join('');
  }
}
