/**
 * @module agent-assertions/session-assertions
 * Session JSONL transcript assertions for AI Agent testing.
 *
 * Parses the session directory structure (meta.json + transcript.jsonl)
 * and provides assertions on message count, tool usage, role sequences,
 * and content patterns.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AssertionResult } from '../types.js';

// =====================================================================
// Types
// =====================================================================

export interface TranscriptMessage {
  id: string;
  parent_id?: string;
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: unknown }>;
  tool_call_id?: string;
  reasoning_content?: string;
  timestamp: string;
}

export interface SessionMeta {
  session_id: string;
  goal: string;
  model: string;
  provider: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  status: string;
  finished_at?: string;
}

export interface SessionAssertionOptions {
  /** Session status must equal this (e.g., "completed") */
  status?: string;
  /** Minimum message count */
  minMessages?: number;
  /** Maximum message count */
  maxMessages?: number;
  /** These tool names must appear in at least one tool_call */
  hasToolCalls?: string[];
  /** These tool names must NOT appear */
  noToolCalls?: string[];
  /** Role sequence pattern (e.g., ["system", "user", "assistant"]) — checks first N */
  startsWithRoles?: string[];
  /** Model name must match */
  model?: string;
  /** Content of any assistant message must contain this string */
  assistantContentContains?: string;
  /** The session must have been finalized (finished_at is set) */
  finalized?: boolean;
}

// =====================================================================
// Parser
// =====================================================================

/**
 * Parse a session directory into structured data.
 *
 * @param sessionDir - Path to the session directory containing meta.json and transcript.jsonl
 * @returns Parsed meta and transcript, or error
 */
export function parseSessionTranscript(sessionDir: string): {
  meta: SessionMeta;
  messages: TranscriptMessage[];
} {
  const metaPath = path.join(sessionDir, '.meta.json');
  const transcriptPath = path.join(sessionDir, 'transcript.jsonl');

  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session meta not found: ${metaPath}`);
  }
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Session transcript not found: ${transcriptPath}`);
  }

  const meta: SessionMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
  const messages: TranscriptMessage[] = lines
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  return { meta, messages };
}

// =====================================================================
// Assertions
// =====================================================================

/**
 * Run comprehensive session assertions.
 *
 * @param sessionDir - Path to session directory
 * @param options - What to assert
 */
export function assertSession(
  sessionDir: string,
  options: SessionAssertionOptions,
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const basePath = `session:${path.basename(sessionDir)}`;

  // Parse
  let meta: SessionMeta;
  let messages: TranscriptMessage[];
  try {
    const parsed = parseSessionTranscript(sessionDir);
    meta = parsed.meta;
    messages = parsed.messages;
  } catch (e) {
    results.push({
      path: basePath,
      operator: 'parse',
      expected: 'valid session',
      actual: (e as Error).message,
      passed: false,
      message: `Failed to parse session: ${(e as Error).message}`,
    });
    return results;
  }

  // Status
  if (options.status !== undefined) {
    const passed = meta.status === options.status;
    results.push({
      path: `${basePath}.status`,
      operator: 'exact',
      expected: options.status,
      actual: meta.status,
      passed,
      message: passed
        ? `Session status is "${options.status}"`
        : `Session status is "${meta.status}", expected "${options.status}"`,
    });
  }

  // Message count
  if (options.minMessages !== undefined) {
    const passed = messages.length >= options.minMessages;
    results.push({
      path: `${basePath}.message_count`,
      operator: 'gte',
      expected: options.minMessages,
      actual: messages.length,
      passed,
      message: passed
        ? `${messages.length} messages >= ${options.minMessages}`
        : `Only ${messages.length} messages (expected >= ${options.minMessages})`,
    });
  }

  if (options.maxMessages !== undefined) {
    const passed = messages.length <= options.maxMessages;
    results.push({
      path: `${basePath}.message_count`,
      operator: 'lte',
      expected: options.maxMessages,
      actual: messages.length,
      passed,
      message: passed
        ? `${messages.length} messages <= ${options.maxMessages}`
        : `${messages.length} messages exceeds max ${options.maxMessages}`,
    });
  }

  // Tool calls present
  if (options.hasToolCalls) {
    const allToolNames = new Set<string>();
    for (const msg of messages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          allToolNames.add(tc.name);
        }
      }
    }

    for (const expectedTool of options.hasToolCalls) {
      const passed = allToolNames.has(expectedTool);
      results.push({
        path: `${basePath}.tool_calls`,
        operator: 'contains',
        expected: expectedTool,
        actual: passed ? '(found)' : `(not in [${[...allToolNames].join(', ')}])`,
        passed,
        message: passed
          ? `Tool "${expectedTool}" was called`
          : `Tool "${expectedTool}" was never called (found: ${[...allToolNames].join(', ')})`,
      });
    }
  }

  // Tool calls absent
  if (options.noToolCalls) {
    const allToolNames = new Set<string>();
    for (const msg of messages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          allToolNames.add(tc.name);
        }
      }
    }

    for (const forbiddenTool of options.noToolCalls) {
      const passed = !allToolNames.has(forbiddenTool);
      results.push({
        path: `${basePath}.tool_calls`,
        operator: 'not_contains',
        expected: `not "${forbiddenTool}"`,
        actual: passed ? '(absent)' : '(found)',
        passed,
        message: passed
          ? `Tool "${forbiddenTool}" correctly not called`
          : `Tool "${forbiddenTool}" was unexpectedly called`,
      });
    }
  }

  // Role sequence
  if (options.startsWithRoles) {
    const actualRoles = messages.slice(0, options.startsWithRoles.length).map(m => m.role);
    const passed = options.startsWithRoles.every((r, i) => actualRoles[i] === r);
    results.push({
      path: `${basePath}.roles`,
      operator: 'startsWith',
      expected: options.startsWithRoles,
      actual: actualRoles,
      passed,
      message: passed
        ? `Message roles start with [${options.startsWithRoles.join(', ')}]`
        : `Expected roles [${options.startsWithRoles.join(', ')}], got [${actualRoles.join(', ')}]`,
    });
  }

  // Model
  if (options.model !== undefined) {
    const passed = meta.model === options.model;
    results.push({
      path: `${basePath}.model`,
      operator: 'exact',
      expected: options.model,
      actual: meta.model,
      passed,
      message: passed ? `Model is "${options.model}"` : `Model is "${meta.model}", expected "${options.model}"`,
    });
  }

  // Assistant content contains
  if (options.assistantContentContains !== undefined) {
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const found = assistantMessages.some(m => m.content.includes(options.assistantContentContains!));
    results.push({
      path: `${basePath}.assistant_content`,
      operator: 'contains',
      expected: options.assistantContentContains,
      actual: found ? '(found)' : `(not found in ${assistantMessages.length} assistant messages)`,
      passed: found,
      message: found
        ? `An assistant message contains "${options.assistantContentContains}"`
        : `No assistant message contains "${options.assistantContentContains}"`,
    });
  }

  // Finalized
  if (options.finalized === true) {
    const passed = meta.finished_at !== undefined && meta.finished_at !== null;
    results.push({
      path: `${basePath}.finished_at`,
      operator: 'exists',
      expected: true,
      actual: passed,
      passed,
      message: passed
        ? `Session is finalized (finished_at set)`
        : `Session not finalized (finished_at missing)`,
    });
  }

  return results;
}

/**
 * Assert on the messages array directly.
 */
export function assertSessionMessages(
  messages: TranscriptMessage[],
  options: {
    /** Total message count range */
    count?: { min?: number; max?: number };
    /** At least one message has this role */
    hasRole?: string;
    /** No message has this role */
    noRole?: string;
  },
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (options.count?.min !== undefined) {
    const passed = messages.length >= options.count.min;
    results.push({
      path: 'messages.count',
      operator: 'gte',
      expected: options.count.min,
      actual: messages.length,
      passed,
      message: passed ? `${messages.length} messages >= ${options.count.min}` : `Only ${messages.length} messages`,
    });
  }

  if (options.hasRole) {
    const found = messages.some(m => m.role === options.hasRole);
    results.push({
      path: 'messages.role',
      operator: 'contains',
      expected: options.hasRole,
      actual: found,
      passed: found,
      message: found ? `Found role "${options.hasRole}"` : `Role "${options.hasRole}" not found`,
    });
  }

  return results;
}

/**
 * Assert specific tool calls occurred.
 */
export function assertSessionToolCalls(
  messages: TranscriptMessage[],
  expectations: {
    /** Tool name → expected minimum invocations */
    toolCounts?: Record<string, number>;
    /** Tool name → at least one call's arguments contain this string */
    toolArgsContain?: Record<string, string>;
  },
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Count tool calls
  const toolCounts = new Map<string, number>();
  const toolArgs = new Map<string, string[]>();

  for (const msg of messages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
        const argStr = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments);
        const existing = toolArgs.get(tc.name) ?? [];
        existing.push(argStr);
        toolArgs.set(tc.name, existing);
      }
    }
  }

  if (expectations.toolCounts) {
    for (const [tool, minCount] of Object.entries(expectations.toolCounts)) {
      const actual = toolCounts.get(tool) ?? 0;
      const passed = actual >= minCount;
      results.push({
        path: `tool_calls.${tool}.count`,
        operator: 'gte',
        expected: minCount,
        actual,
        passed,
        message: passed
          ? `Tool "${tool}" called ${actual} times (>= ${minCount})`
          : `Tool "${tool}" called ${actual} times (expected >= ${minCount})`,
      });
    }
  }

  if (expectations.toolArgsContain) {
    for (const [tool, needle] of Object.entries(expectations.toolArgsContain)) {
      const args = toolArgs.get(tool) ?? [];
      const found = args.some(a => a.includes(needle));
      results.push({
        path: `tool_calls.${tool}.args`,
        operator: 'contains',
        expected: needle,
        actual: found ? '(found)' : '(not found)',
        passed: found,
        message: found
          ? `Tool "${tool}" was called with args containing "${needle}"`
          : `Tool "${tool}" was never called with args containing "${needle}"`,
      });
    }
  }

  return results;
}
