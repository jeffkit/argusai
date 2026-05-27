/**
 * @module agent-assertions/agent-runner
 * Agent test runner — orchestrates running an agent and asserting on outputs.
 *
 * This runner:
 * 1. Executes an agent binary with a given goal in a workspace
 * 2. Waits for completion
 * 3. Runs programmatic assertions on workspace outputs + session data
 * 4. Optionally runs LLM-as-judge for semantic evaluation
 *
 * Designed to work with ArgusAI's test runner registry.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { TestRunner, RunConfig, TestEvent, AssertionResult } from '../types.js';
import { assertFile, assertFileContent, assertFileJson } from './file-assertions.js';
import { assertSession } from './session-assertions.js';
import { assertCost } from './cost-assertions.js';
import { judgeLlm } from './llm-judge.js';
import type { SessionAssertionOptions } from './session-assertions.js';
import type { CostAssertionOptions } from './cost-assertions.js';
import type { JudgeOptions, JudgeResult } from './llm-judge.js';

// =====================================================================
// Types
// =====================================================================

export interface AgentTestConfig {
  /** Path to agent binary */
  binary: string;
  /** Goal/task for the agent */
  goal: string;
  /** Workspace directory (will be created if not exists) */
  workspace: string;
  /** Additional CLI arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Maximum execution time (ms, default 120000) */
  timeout?: number;
  /** Assertions to run after agent completes */
  assertions: AgentAssertions;
}

export interface AgentAssertions {
  /** Agent must exit with code 0 */
  exitSuccess?: boolean;
  /** Files that must exist in workspace */
  filesExist?: string[];
  /** File content checks */
  fileContent?: Array<{
    path: string;
    contains?: string;
    exact?: string;
    matches?: string;
  }>;
  /** JSON file field checks */
  jsonFiles?: Array<{
    path: string;
    assertions: Record<string, unknown>;
  }>;
  /** Session assertions */
  session?: SessionAssertionOptions;
  /** Cost assertions */
  cost?: CostAssertionOptions;
  /** LLM-as-judge (optional, requires API key) */
  judge?: {
    enabled: boolean;
    minScore?: number;
    apiBase?: string;
    model?: string;
  };
}

// =====================================================================
// Runner
// =====================================================================

/**
 * Agent test runner for ArgusAI.
 *
 * Register with RunnerRegistry:
 * ```ts
 * registry.register(new AgentTestRunner());
 * ```
 */
export class AgentTestRunner implements TestRunner {
  id = 'agent';

  async *run(config: RunConfig): AsyncGenerator<TestEvent> {
    // Parse agent config from the target (YAML/JSON file path)
    const agentConfig: AgentTestConfig = JSON.parse(
      fs.readFileSync(config.target, 'utf-8'),
    );

    const suiteName = `agent:${agentConfig.goal.slice(0, 50)}`;
    const suiteStart = Date.now();
    let passed = 0;
    let failed = 0;

    yield { type: 'suite_start', suite: suiteName, timestamp: Date.now() };

    // Step 1: Run the agent
    yield { type: 'case_start', suite: suiteName, name: 'agent_execution', timestamp: Date.now() };

    const execStart = Date.now();
    const exitCode = await this.executeAgent(agentConfig, config);
    const execDuration = Date.now() - execStart;

    if (agentConfig.assertions.exitSuccess !== false && exitCode !== 0) {
      failed++;
      yield {
        type: 'case_fail',
        suite: suiteName,
        name: 'agent_execution',
        error: `Agent exited with code ${exitCode}`,
        duration: execDuration,
        timestamp: Date.now(),
      };
    } else {
      passed++;
      yield { type: 'case_pass', suite: suiteName, name: 'agent_execution', duration: execDuration, timestamp: Date.now() };
    }

    // Step 2: Run assertions
    const assertionResults = await this.runAssertions(agentConfig);
    for (const result of assertionResults) {
      const caseName = `assert:${result.path}`;
      yield { type: 'case_start', suite: suiteName, name: caseName, timestamp: Date.now() };
      if (result.passed) {
        passed++;
        yield { type: 'case_pass', suite: suiteName, name: caseName, duration: 0, timestamp: Date.now() };
      } else {
        failed++;
        yield {
          type: 'case_fail',
          suite: suiteName,
          name: caseName,
          error: result.message,
          duration: 0,
          timestamp: Date.now(),
          assertions: [result],
        };
      }
    }

    // Step 3: LLM judge (if configured)
    if (agentConfig.assertions.judge?.enabled) {
      yield { type: 'case_start', suite: suiteName, name: 'llm_judge', timestamp: Date.now() };
      const judgeStart = Date.now();
      try {
        const judgeResult = await this.runJudge(agentConfig);
        const minScore = agentConfig.assertions.judge.minScore ?? 3;
        const judgePassed = judgeResult.completed && judgeResult.score >= minScore;

        if (judgePassed) {
          passed++;
          yield {
            type: 'case_pass',
            suite: suiteName,
            name: `llm_judge (score=${judgeResult.score}/5)`,
            duration: Date.now() - judgeStart,
            timestamp: Date.now(),
          };
        } else {
          failed++;
          yield {
            type: 'case_fail',
            suite: suiteName,
            name: 'llm_judge',
            error: `Judge: completed=${judgeResult.completed}, score=${judgeResult.score}/5 (min ${minScore}). Reason: ${judgeResult.reason}`,
            duration: Date.now() - judgeStart,
            timestamp: Date.now(),
          };
        }
      } catch (e) {
        yield {
          type: 'log',
          level: 'warn',
          message: `LLM judge skipped: ${(e as Error).message}`,
          timestamp: Date.now(),
        };
      }
    }

    yield {
      type: 'suite_end',
      suite: suiteName,
      passed,
      failed,
      skipped: 0,
      duration: Date.now() - suiteStart,
      timestamp: Date.now(),
    };
  }

  async available(): Promise<boolean> {
    return true;
  }

  // =====================================================================
  // Private helpers
  // =====================================================================

  private executeAgent(agentConfig: AgentTestConfig, runConfig: RunConfig): Promise<number> {
    return new Promise((resolve) => {
      const args = [
        '--workspace', agentConfig.workspace,
        'run', agentConfig.goal,
        ...(agentConfig.args ?? []),
      ];

      const proc = spawn(agentConfig.binary, args, {
        cwd: runConfig.cwd,
        env: { ...process.env, ...runConfig.env, ...agentConfig.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: agentConfig.timeout ?? 120000,
      });

      proc.on('close', (code) => resolve(code ?? 1));
      proc.on('error', () => resolve(1));
    });
  }

  private async runAssertions(config: AgentTestConfig): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];
    const ws = config.workspace;

    // File existence
    if (config.assertions.filesExist) {
      for (const f of config.assertions.filesExist) {
        results.push(assertFile(path.join(ws, f)));
      }
    }

    // File content
    if (config.assertions.fileContent) {
      for (const fc of config.assertions.fileContent) {
        results.push(...assertFileContent(path.join(ws, fc.path), {
          contains: fc.contains,
          exact: fc.exact,
          matches: fc.matches,
        }));
      }
    }

    // JSON files
    if (config.assertions.jsonFiles) {
      for (const jf of config.assertions.jsonFiles) {
        results.push(...assertFileJson(path.join(ws, jf.path), jf.assertions));
      }
    }

    // Session
    if (config.assertions.session) {
      const sessionsDir = path.join(ws, '.recursive', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        // Find the most recent session directory
        const sessionDirs = fs.readdirSync(sessionsDir)
          .map(d => path.join(sessionsDir, d))
          .filter(d => fs.statSync(d).isDirectory())
          .sort()
          .reverse();

        if (sessionDirs.length > 0) {
          // Find the actual session subdirectory (sessions are nested: sessions/<slug>/<id>/)
          const slugDir = sessionDirs[0]!;
          const innerDirs = fs.readdirSync(slugDir)
            .map(d => path.join(slugDir, d))
            .filter(d => fs.statSync(d).isDirectory())
            .sort()
            .reverse();

          const sessionDir = innerDirs.length > 0 ? innerDirs[0]! : slugDir;
          results.push(...assertSession(sessionDir, config.assertions.session));
        } else {
          results.push({
            path: 'session',
            operator: 'exists',
            expected: true,
            actual: false,
            passed: false,
            message: 'No session directory found',
          });
        }
      } else {
        results.push({
          path: 'session',
          operator: 'exists',
          expected: true,
          actual: false,
          passed: false,
          message: `Sessions directory not found: ${sessionsDir}`,
        });
      }
    }

    // Cost
    if (config.assertions.cost) {
      const sessionsDir = path.join(ws, '.recursive', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        // Find cost.json in most recent session
        const costFiles = findFiles(sessionsDir, 'cost.json');
        if (costFiles.length > 0) {
          results.push(...assertCost(costFiles[costFiles.length - 1]!, config.assertions.cost));
        } else if (config.assertions.cost.exists !== false) {
          results.push({
            path: 'cost.json',
            operator: 'exists',
            expected: true,
            actual: false,
            passed: false,
            message: 'cost.json not found in any session directory',
          });
        }
      }
    }

    return results;
  }

  private async runJudge(config: AgentTestConfig): Promise<JudgeResult> {
    // Load transcript from session
    const sessionsDir = path.join(config.workspace, '.recursive', 'sessions');
    const transcriptFiles = findFiles(sessionsDir, 'transcript.jsonl');

    if (transcriptFiles.length === 0) {
      throw new Error('No transcript.jsonl found for judge evaluation');
    }

    const transcriptPath = transcriptFiles[transcriptFiles.length - 1]!;
    const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    const transcript = lines.map(l => JSON.parse(l) as { role: string; content: string; tool_calls?: unknown[] });

    // Get workspace state (file listing)
    const workspaceState = getWorkspaceSnapshot(config.workspace);

    return judgeLlm({
      goal: config.goal,
      transcript,
      workspaceState,
      apiBase: config.assertions.judge?.apiBase,
      model: config.assertions.judge?.model,
    });
  }
}

// =====================================================================
// Utilities
// =====================================================================

function findFiles(dir: string, filename: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, filename));
    } else if (entry.name === filename) {
      results.push(fullPath);
    }
  }
  return results;
}

function getWorkspaceSnapshot(workspace: string): string {
  const lines: string[] = ['Files in workspace:'];
  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.recursive') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        if (prefix.length < 8) walk(fullPath, prefix + '  '); // max 4 levels
      } else {
        const stat = fs.statSync(fullPath);
        lines.push(`${prefix}${entry.name} (${stat.size}B)`);
      }
    }
  };
  try {
    walk(workspace, '  ');
  } catch {
    lines.push('  (error reading workspace)');
  }
  return lines.join('\n');
}
