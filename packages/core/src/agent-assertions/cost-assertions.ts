/**
 * @module agent-assertions/cost-assertions
 * Cost and metrics assertions for AI Agent testing.
 *
 * Validates the cost.json file produced by an agent's CostTracker,
 * checking token counts, pricing, and cost computations.
 */

import fs from 'node:fs';
import type { AssertionResult } from '../types.js';

export interface CostAssertionOptions {
  /** cost.json must exist */
  exists?: boolean;
  /** tokens_prompt must be > 0 */
  hasTokens?: boolean;
  /** cost_usd must be > 0 */
  hasCost?: boolean;
  /** model field must match */
  model?: string;
  /** cost_usd must be less than this (budget guard) */
  maxCostUsd?: number;
  /** tokens_prompt must be less than this */
  maxPromptTokens?: number;
}

/**
 * Assert on a cost.json file.
 *
 * @param costJsonPath - Path to the cost.json file
 * @param options - What to assert
 */
export function assertCost(
  costJsonPath: string,
  options: CostAssertionOptions = {},
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const basePath = `cost:${costJsonPath}`;

  // Existence
  if (options.exists !== false) {
    const exists = fs.existsSync(costJsonPath);
    results.push({
      path: basePath,
      operator: 'exists',
      expected: true,
      actual: exists,
      passed: exists,
      message: exists ? 'cost.json exists' : 'cost.json not found',
    });
    if (!exists) return results;
  }

  // Parse
  let data: Record<string, any>;
  try {
    data = JSON.parse(fs.readFileSync(costJsonPath, 'utf-8'));
  } catch (e) {
    results.push({
      path: basePath,
      operator: 'parse',
      expected: 'valid JSON',
      actual: (e as Error).message,
      passed: false,
      message: `Failed to parse cost.json: ${(e as Error).message}`,
    });
    return results;
  }

  // Has tokens
  if (options.hasTokens) {
    const promptTokens = data.tokens_prompt ?? data.total_usage?.prompt_tokens ?? 0;
    const passed = typeof promptTokens === 'number' && promptTokens > 0;
    results.push({
      path: `${basePath}.tokens_prompt`,
      operator: 'gt',
      expected: '> 0',
      actual: promptTokens,
      passed,
      message: passed
        ? `Prompt tokens: ${promptTokens}`
        : `Prompt tokens is ${promptTokens} (expected > 0)`,
    });
  }

  // Has cost
  if (options.hasCost) {
    const costUsd = data.cost_usd ?? 0;
    const passed = typeof costUsd === 'number' && costUsd > 0;
    results.push({
      path: `${basePath}.cost_usd`,
      operator: 'gt',
      expected: '> 0',
      actual: costUsd,
      passed,
      message: passed
        ? `Cost: $${costUsd}`
        : `Cost is ${costUsd} (expected > 0)`,
    });
  }

  // Model
  if (options.model) {
    const actual = data.model;
    const passed = actual === options.model;
    results.push({
      path: `${basePath}.model`,
      operator: 'exact',
      expected: options.model,
      actual,
      passed,
      message: passed ? `Model: ${options.model}` : `Model: ${actual} (expected ${options.model})`,
    });
  }

  // Max cost (budget guard)
  if (options.maxCostUsd !== undefined) {
    const costUsd = typeof data.cost_usd === 'number' ? data.cost_usd : 0;
    const passed = costUsd <= options.maxCostUsd;
    results.push({
      path: `${basePath}.cost_usd`,
      operator: 'lte',
      expected: options.maxCostUsd,
      actual: costUsd,
      passed,
      message: passed
        ? `Cost $${costUsd} <= budget $${options.maxCostUsd}`
        : `Cost $${costUsd} EXCEEDS budget $${options.maxCostUsd}`,
    });
  }

  // Max prompt tokens
  if (options.maxPromptTokens !== undefined) {
    const tokens = data.tokens_prompt ?? data.total_usage?.prompt_tokens ?? 0;
    const passed = typeof tokens === 'number' && tokens <= options.maxPromptTokens;
    results.push({
      path: `${basePath}.tokens_prompt`,
      operator: 'lte',
      expected: options.maxPromptTokens,
      actual: tokens,
      passed,
      message: passed
        ? `Prompt tokens ${tokens} <= ${options.maxPromptTokens}`
        : `Prompt tokens ${tokens} exceeds max ${options.maxPromptTokens}`,
    });
  }

  return results;
}
