/**
 * @module agent-assertions/file-assertions
 * File system assertions for verifying agent workspace outputs.
 *
 * These work on the local filesystem (inside Docker container or host)
 * after an agent has completed its task.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AssertionResult } from '../types.js';

/**
 * Assert that a file exists at the given path.
 */
export function assertFile(filePath: string): AssertionResult {
  const exists = fs.existsSync(filePath);
  return {
    path: `file:${filePath}`,
    operator: 'exists',
    expected: true,
    actual: exists,
    passed: exists,
    message: exists
      ? `File exists: ${filePath}`
      : `Expected file to exist: ${filePath}`,
  };
}

/**
 * Assert that a file does NOT exist.
 */
export function assertFileNotExists(filePath: string): AssertionResult {
  const exists = fs.existsSync(filePath);
  return {
    path: `file:${filePath}`,
    operator: 'not_exists',
    expected: false,
    actual: exists,
    passed: !exists,
    message: !exists
      ? `File correctly absent: ${filePath}`
      : `Expected file to NOT exist: ${filePath}`,
  };
}

/**
 * Assert file content matches expectations.
 */
export function assertFileContent(
  filePath: string,
  options: {
    /** Exact full content match */
    exact?: string;
    /** Content contains this substring */
    contains?: string;
    /** Content does NOT contain this substring */
    notContains?: string;
    /** Content matches this regex */
    matches?: string;
    /** Minimum line count */
    minLines?: number;
    /** Maximum file size in bytes */
    maxSize?: number;
  },
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const basePath = `file:${filePath}`;

  if (!fs.existsSync(filePath)) {
    results.push({
      path: basePath,
      operator: 'exists',
      expected: true,
      actual: false,
      passed: false,
      message: `File not found: ${filePath}`,
    });
    return results;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  if (options.exact !== undefined) {
    const passed = content === options.exact;
    results.push({
      path: basePath,
      operator: 'exact',
      expected: options.exact.length > 100 ? `${options.exact.slice(0, 100)}...` : options.exact,
      actual: content.length > 100 ? `${content.slice(0, 100)}...` : content,
      passed,
      message: passed
        ? `File content matches exactly`
        : `File content mismatch`,
    });
  }

  if (options.contains !== undefined) {
    const passed = content.includes(options.contains);
    results.push({
      path: basePath,
      operator: 'contains',
      expected: options.contains,
      actual: passed ? '(found)' : `(not found in ${content.length} chars)`,
      passed,
      message: passed
        ? `File contains "${options.contains}"`
        : `File does not contain "${options.contains}"`,
    });
  }

  if (options.notContains !== undefined) {
    const passed = !content.includes(options.notContains);
    results.push({
      path: basePath,
      operator: 'notContains',
      expected: `not "${options.notContains}"`,
      actual: passed ? '(absent)' : '(found)',
      passed,
      message: passed
        ? `File correctly does not contain "${options.notContains}"`
        : `File unexpectedly contains "${options.notContains}"`,
    });
  }

  if (options.matches !== undefined) {
    const regex = new RegExp(options.matches);
    const passed = regex.test(content);
    results.push({
      path: basePath,
      operator: 'matches',
      expected: options.matches,
      actual: passed ? '(matched)' : '(no match)',
      passed,
      message: passed
        ? `File content matches pattern /${options.matches}/`
        : `File content does not match pattern /${options.matches}/`,
    });
  }

  if (options.minLines !== undefined) {
    const lineCount = content.split('\n').length;
    const passed = lineCount >= options.minLines;
    results.push({
      path: basePath,
      operator: 'minLines',
      expected: options.minLines,
      actual: lineCount,
      passed,
      message: passed
        ? `File has ${lineCount} lines (>= ${options.minLines})`
        : `File has ${lineCount} lines (expected >= ${options.minLines})`,
    });
  }

  if (options.maxSize !== undefined) {
    const stat = fs.statSync(filePath);
    const passed = stat.size <= options.maxSize;
    results.push({
      path: basePath,
      operator: 'maxSize',
      expected: options.maxSize,
      actual: stat.size,
      passed,
      message: passed
        ? `File size ${stat.size}B <= ${options.maxSize}B`
        : `File size ${stat.size}B exceeds max ${options.maxSize}B`,
    });
  }

  return results;
}

/**
 * Assert JSON file fields.
 */
export function assertFileJson(
  filePath: string,
  assertions: Record<string, unknown>,
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const basePath = `json:${filePath}`;

  if (!fs.existsSync(filePath)) {
    results.push({
      path: basePath,
      operator: 'exists',
      expected: true,
      actual: false,
      passed: false,
      message: `JSON file not found: ${filePath}`,
    });
    return results;
  }

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    results.push({
      path: basePath,
      operator: 'parse',
      expected: 'valid JSON',
      actual: `parse error: ${(e as Error).message}`,
      passed: false,
      message: `Failed to parse JSON: ${filePath}`,
    });
    return results;
  }

  for (const [key, expected] of Object.entries(assertions)) {
    const actual = getNestedValue(data, key);

    if (expected === '$exists') {
      const passed = actual !== undefined && actual !== null;
      results.push({
        path: `${basePath}.${key}`,
        operator: 'exists',
        expected: true,
        actual: passed,
        passed,
        message: passed ? `${key} exists` : `${key} is missing`,
      });
    } else if (typeof expected === 'object' && expected !== null && 'gt' in (expected as Record<string, unknown>)) {
      const threshold = (expected as { gt: number }).gt;
      const passed = typeof actual === 'number' && actual > threshold;
      results.push({
        path: `${basePath}.${key}`,
        operator: 'gt',
        expected: `> ${threshold}`,
        actual,
        passed,
        message: passed ? `${key} = ${actual} > ${threshold}` : `${key} = ${actual}, expected > ${threshold}`,
      });
    } else {
      const passed = actual === expected;
      results.push({
        path: `${basePath}.${key}`,
        operator: 'exact',
        expected,
        actual,
        passed,
        message: passed ? `${key} matches` : `${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      });
    }
  }

  return results;
}

/** Get a nested value from an object using dot notation */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}
