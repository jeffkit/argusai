/**
 * @module assertion-engine
 * Assertion DSL engine for preflight.
 *
 * Evaluates YAML `expect` blocks against actual HTTP response data.
 * Supports exact matching, type checks, existence, numeric comparisons,
 * string operations, regex matching, length checks, and nested object assertions.
 *
 * Also provides generic workspace file assertions (assertFile, assertFileContent,
 * assertFileJson, assertFileNotExists) and LLM-as-judge evaluation (judgeLlm)
 * for AI Agent E2E testing.
 */

import fs from 'node:fs';
import type { AssertionResult } from './types.js';

// =====================================================================
// Assertion Operator Names
// =====================================================================

/** Set of recognized assertion operator keys */
const ASSERTION_OPERATORS = new Set([
  'type',
  'exists',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'matches',
  'startsWith',
  'endsWith',
  'length',
  'every',
  'some',
  'not',
]);

// =====================================================================
// Public API
// =====================================================================

/**
 * Assert the response body against expected value rules.
 *
 * For each key in `expected`:
 * - If the value is a **primitive** (string, number, boolean, null) → exact match
 * - If the value is an **object with operator keys** → run operator assertions
 * - If the value is a **plain nested object** → recurse into sub-fields
 *
 * @param actual - The actual response body (parsed JSON)
 * @param expected - The expected value rules from YAML `expect.body`
 * @param basePath - Dot-separated path prefix for error reporting (default: "body")
 * @returns Array of assertion results (one per check)
 */
export function assertBody(
  actual: unknown,
  expected: Record<string, unknown>,
  basePath = 'body',
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    const currentPath = basePath ? `${basePath}.${key}` : key;
    const actualValue = getNestedValue(actual, key);

    results.push(...evaluateAssertion(actualValue, expectedValue, currentPath));
  }

  return results;
}

/**
 * Assert the HTTP status code.
 *
 * @param actual - Actual HTTP status code
 * @param expected - Expected status code (single number or array of acceptable codes)
 * @returns A single assertion result
 */
export function assertStatus(
  actual: number,
  expected: number | number[],
): AssertionResult {
  if (Array.isArray(expected)) {
    const passed = expected.includes(actual);
    return {
      path: 'status',
      operator: 'in',
      expected,
      actual,
      passed,
      message: passed
        ? `Status ${actual} is in [${expected.join(', ')}]`
        : `Expected status to be one of [${expected.join(', ')}], got ${actual}`,
    };
  }

  const passed = actual === expected;
  return {
    path: 'status',
    operator: 'exact',
    expected,
    actual,
    passed,
    message: passed
      ? `Status is ${actual}`
      : `Expected status ${expected}, got ${actual}`,
  };
}

/**
 * Assert response headers against expected rules.
 *
 * Header names are compared case-insensitively.
 *
 * @param actual - Actual response headers (lowercase keys)
 * @param expected - Expected header rules
 * @returns Array of assertion results
 */
export function assertHeaders(
  actual: Record<string, string>,
  expected: Record<string, unknown>,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Normalize actual headers to lowercase keys
  const normalizedActual: Record<string, string> = {};
  for (const [key, value] of Object.entries(actual)) {
    normalizedActual[key.toLowerCase()] = value;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const lowerKey = key.toLowerCase();
    const currentPath = `headers.${lowerKey}`;
    const actualValue: unknown = normalizedActual[lowerKey];

    results.push(...evaluateAssertion(actualValue, expectedValue, currentPath));
  }

  return results;
}

// =====================================================================
// Core Evaluation Logic
// =====================================================================

/**
 * Evaluate an assertion for a single value.
 *
 * Dispatches to the appropriate handler based on the expected value type:
 * - Primitive → exact match
 * - Object with operator keys → operator assertions
 * - Plain object → nested recursive assertions
 */
function evaluateAssertion(
  actual: unknown,
  expected: unknown,
  path: string,
): AssertionResult[] {
  // Null exact match
  if (expected === null) {
    return [exactMatch(actual, null, path)];
  }

  // Primitive exact match (string, number, boolean)
  if (typeof expected !== 'object') {
    return [exactMatch(actual, expected, path)];
  }

  // Array — exact match
  if (Array.isArray(expected)) {
    return [exactMatch(actual, expected, path)];
  }

  // Object — check if it contains operator keys
  const expectedObj = expected as Record<string, unknown>;
  const keys = Object.keys(expectedObj);

  if (keys.length === 0) {
    return [exactMatch(actual, expected, path)];
  }

  const hasOperators = keys.some((k) => ASSERTION_OPERATORS.has(k));

  if (hasOperators) {
    return runOperatorAssertions(actual, expectedObj, path);
  }

  // Plain nested object — recurse
  return assertNestedObject(actual, expectedObj, path);
}

/**
 * Run operator-based assertions on a value.
 */
function runOperatorAssertions(
  actual: unknown,
  operators: Record<string, unknown>,
  path: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const [op, expected] of Object.entries(operators)) {
    if (!ASSERTION_OPERATORS.has(op)) {
      // Not an operator — treat as nested key
      const nestedActual = getNestedValue(actual, op);
      results.push(...evaluateAssertion(nestedActual, expected, `${path}.${op}`));
      continue;
    }

    switch (op) {
      case 'type':
        results.push(assertType(actual, expected as string, path));
        break;
      case 'exists':
        results.push(assertExists(actual, expected as boolean, path));
        break;
      case 'in':
        results.push(assertIn(actual, expected as unknown[], path));
        break;
      case 'gt':
        results.push(assertComparison(actual, expected as number, 'gt', path));
        break;
      case 'gte':
        results.push(assertComparison(actual, expected as number, 'gte', path));
        break;
      case 'lt':
        results.push(assertComparison(actual, expected as number, 'lt', path));
        break;
      case 'lte':
        results.push(assertComparison(actual, expected as number, 'lte', path));
        break;
      case 'contains':
        results.push(assertContains(actual, expected, path));
        break;
      case 'matches':
        results.push(assertMatches(actual, expected as string, path));
        break;
      case 'startsWith':
        results.push(assertStartsWith(actual, expected as string, path));
        break;
      case 'endsWith':
        results.push(assertEndsWith(actual, expected as string, path));
        break;
      case 'notContains':
        results.push(assertNotContains(actual, expected, path));
        break;
      case 'length':
        results.push(...assertLength(actual, expected, path));
        break;
      case 'every':
        results.push(...assertEvery(actual, expected as Record<string, unknown>, path));
        break;
      case 'some':
        results.push(...assertSome(actual, expected as Record<string, unknown>, path));
        break;
      case 'not':
        results.push(...assertNot(actual, expected, path));
        break;
    }
  }

  return results;
}

/**
 * Recursively assert nested object fields.
 */
function assertNestedObject(
  actual: unknown,
  expected: Record<string, unknown>,
  basePath: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (actual === null || actual === undefined || typeof actual !== 'object') {
    results.push({
      path: basePath,
      operator: 'object',
      expected: 'object',
      actual: actual === null ? 'null' : typeof actual,
      passed: false,
      message: `Expected ${basePath} to be an object, got ${actual === null ? 'null' : typeof actual}`,
    });
    return results;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    const currentPath = `${basePath}.${key}`;
    const actualValue = (actual as Record<string, unknown>)[key];
    results.push(...evaluateAssertion(actualValue, expectedValue, currentPath));
  }

  return results;
}

// =====================================================================
// Individual Assertion Operators
// =====================================================================

/** Exact value match */
function exactMatch(actual: unknown, expected: unknown, path: string): AssertionResult {
  const passed = deepEqual(actual, expected);
  return {
    path,
    operator: 'exact',
    expected,
    actual,
    passed,
    message: passed
      ? `${path} equals ${JSON.stringify(expected)}`
      : `Expected ${path} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

/** Type check assertion */
function assertType(actual: unknown, expectedType: string, path: string): AssertionResult {
  let actualType: string;

  if (actual === null) {
    actualType = 'null';
  } else if (Array.isArray(actual)) {
    actualType = 'array';
  } else {
    actualType = typeof actual;
  }

  const passed = actualType === expectedType;
  return {
    path,
    operator: 'type',
    expected: expectedType,
    actual: actualType,
    passed,
    message: passed
      ? `${path} is of type ${expectedType}`
      : `Expected ${path} to be of type ${expectedType}, got ${actualType}`,
  };
}

/** Existence check assertion */
function assertExists(actual: unknown, shouldExist: boolean, path: string): AssertionResult {
  const exists = actual !== undefined && actual !== null;
  const passed = exists === shouldExist;
  return {
    path,
    operator: 'exists',
    expected: shouldExist,
    actual: exists,
    passed,
    message: passed
      ? shouldExist
        ? `${path} exists`
        : `${path} does not exist`
      : shouldExist
        ? `Expected ${path} to exist, but it is ${actual === null ? 'null' : 'undefined'}`
        : `Expected ${path} not to exist, but got ${JSON.stringify(actual)}`,
  };
}

/** Set inclusion assertion */
function assertIn(actual: unknown, allowedValues: unknown[], path: string): AssertionResult {
  const passed = allowedValues.some((v) => deepEqual(actual, v));
  return {
    path,
    operator: 'in',
    expected: allowedValues,
    actual,
    passed,
    message: passed
      ? `${path} is in [${allowedValues.map((v) => JSON.stringify(v)).join(', ')}]`
      : `Expected ${path} to be one of [${allowedValues.map((v) => JSON.stringify(v)).join(', ')}], got ${JSON.stringify(actual)}`,
  };
}

/** Numeric comparison assertion */
function assertComparison(
  actual: unknown,
  expected: number,
  op: 'gt' | 'gte' | 'lt' | 'lte',
  path: string,
): AssertionResult {
  if (typeof actual !== 'number') {
    return {
      path,
      operator: op,
      expected,
      actual,
      passed: false,
      message: `Expected ${path} to be a number for ${op} comparison, got ${typeof actual}`,
    };
  }

  let passed: boolean;
  let symbol: string;
  switch (op) {
    case 'gt':
      passed = actual > expected;
      symbol = '>';
      break;
    case 'gte':
      passed = actual >= expected;
      symbol = '>=';
      break;
    case 'lt':
      passed = actual < expected;
      symbol = '<';
      break;
    case 'lte':
      passed = actual <= expected;
      symbol = '<=';
      break;
  }

  return {
    path,
    operator: op,
    expected,
    actual,
    passed,
    message: passed
      ? `${path} (${actual}) ${symbol} ${expected}`
      : `Expected ${path} ${symbol} ${expected}, got ${actual}`,
  };
}

/** String/array contains assertion */
function assertContains(actual: unknown, expected: unknown, path: string): AssertionResult {
  let passed = false;

  if (typeof actual === 'string' && typeof expected === 'string') {
    passed = actual.includes(expected);
  } else if (Array.isArray(actual)) {
    passed = actual.some((item) => deepEqual(item, expected));
  }

  return {
    path,
    operator: 'contains',
    expected,
    actual,
    passed,
    message: passed
      ? `${path} contains ${JSON.stringify(expected)}`
      : `Expected ${path} to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  };
}

/** Regex match assertion */
function assertMatches(actual: unknown, pattern: string, path: string): AssertionResult {
  if (typeof actual !== 'string') {
    return {
      path,
      operator: 'matches',
      expected: pattern,
      actual,
      passed: false,
      message: `Expected ${path} to be a string for regex match, got ${typeof actual}`,
    };
  }

  const regex = new RegExp(pattern);
  const passed = regex.test(actual);
  return {
    path,
    operator: 'matches',
    expected: pattern,
    actual,
    passed,
    message: passed
      ? `${path} matches /${pattern}/`
      : `Expected ${path} to match /${pattern}/, got "${actual}"`,
  };
}

/** String prefix assertion */
function assertStartsWith(actual: unknown, prefix: string, path: string): AssertionResult {
  if (typeof actual !== 'string') {
    return {
      path,
      operator: 'startsWith',
      expected: prefix,
      actual,
      passed: false,
      message: `Expected ${path} to be a string for startsWith, got ${typeof actual}`,
    };
  }

  const passed = actual.startsWith(prefix);
  return {
    path,
    operator: 'startsWith',
    expected: prefix,
    actual,
    passed,
    message: passed
      ? `${path} starts with "${prefix}"`
      : `Expected ${path} to start with "${prefix}", got "${actual}"`,
  };
}

/**
 * Length assertion.
 *
 * Supports:
 * - `length: 5` — exact length match
 * - `length: { gt: 0 }` — numeric comparison on length
 */
function assertLength(
  actual: unknown,
  expected: unknown,
  path: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Get length from actual value
  let actualLength: number | undefined;
  if (typeof actual === 'string' || Array.isArray(actual)) {
    actualLength = actual.length;
  } else if (actual !== null && actual !== undefined && typeof actual === 'object') {
    actualLength = Object.keys(actual as Record<string, unknown>).length;
  }

  if (actualLength === undefined) {
    results.push({
      path,
      operator: 'length',
      expected,
      actual,
      passed: false,
      message: `Expected ${path} to have a length property, got ${typeof actual}`,
    });
    return results;
  }

  // Exact length match
  if (typeof expected === 'number') {
    const passed = actualLength === expected;
    results.push({
      path,
      operator: 'length',
      expected,
      actual: actualLength,
      passed,
      message: passed
        ? `${path} has length ${expected}`
        : `Expected ${path} to have length ${expected}, got ${actualLength}`,
    });
    return results;
  }

  // Comparison operators on length
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    const lengthOps = expected as Record<string, number>;
    for (const [op, value] of Object.entries(lengthOps)) {
      if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
        const compResult = assertComparison(
          actualLength,
          value,
          op as 'gt' | 'gte' | 'lt' | 'lte',
          `${path}.length`,
        );
        results.push(compResult);
      }
    }
    return results;
  }

  results.push({
    path,
    operator: 'length',
    expected,
    actual: actualLength,
    passed: false,
    message: `Invalid length assertion value for ${path}: ${JSON.stringify(expected)}`,
  });

  return results;
}

/** String suffix assertion */
function assertEndsWith(actual: unknown, suffix: string, path: string): AssertionResult {
  if (typeof actual !== 'string') {
    return {
      path,
      operator: 'endsWith',
      expected: suffix,
      actual,
      passed: false,
      message: `Expected ${path} to be a string for endsWith, got ${typeof actual}`,
    };
  }

  const passed = actual.endsWith(suffix);
  return {
    path,
    operator: 'endsWith',
    expected: suffix,
    actual,
    passed,
    message: passed
      ? `${path} ends with "${suffix}"`
      : `Expected ${path} to end with "${suffix}", got "${actual}"`,
  };
}

/** Negated string/array contains assertion */
function assertNotContains(actual: unknown, expected: unknown, path: string): AssertionResult {
  let contained = false;

  if (typeof actual === 'string' && typeof expected === 'string') {
    contained = actual.includes(expected);
  } else if (Array.isArray(actual)) {
    contained = actual.some((item) => deepEqual(item, expected));
  }

  return {
    path,
    operator: 'notContains',
    expected,
    actual,
    passed: !contained,
    message: !contained
      ? `${path} does not contain ${JSON.stringify(expected)}`
      : `Expected ${path} not to contain ${JSON.stringify(expected)}`,
  };
}

/**
 * Array `every` assertion — all items must satisfy the given conditions.
 *
 * @example
 * ```yaml
 * items:
 *   every:
 *     email: { exists: true }
 *     role: { in: [admin, user] }
 * ```
 */
function assertEvery(
  actual: unknown,
  conditions: Record<string, unknown>,
  path: string,
): AssertionResult[] {
  if (!Array.isArray(actual)) {
    return [{
      path,
      operator: 'every',
      expected: 'array',
      actual: actual === null ? 'null' : typeof actual,
      passed: false,
      message: `Expected ${path} to be an array for 'every' assertion, got ${actual === null ? 'null' : typeof actual}`,
    }];
  }

  if (actual.length === 0) {
    return [{
      path,
      operator: 'every',
      expected: conditions,
      actual: [],
      passed: true,
      message: `${path} is empty — 'every' vacuously passes`,
    }];
  }

  const failures: AssertionResult[] = [];

  for (let i = 0; i < actual.length; i++) {
    const item = actual[i];
    const itemPath = `${path}[${i}]`;

    if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
      const itemResults = evaluateAssertion(item, conditions, itemPath);
      const itemFailures = itemResults.filter(r => !r.passed);
      if (itemFailures.length > 0) {
        failures.push(...itemFailures);
      }
    } else {
      const itemResults = assertBody(item, conditions, itemPath);
      const itemFailures = itemResults.filter(r => !r.passed);
      if (itemFailures.length > 0) {
        failures.push(...itemFailures);
      }
    }
  }

  if (failures.length === 0) {
    return [{
      path,
      operator: 'every',
      expected: conditions,
      actual: `all ${actual.length} items passed`,
      passed: true,
      message: `${path}: all ${actual.length} items satisfy 'every' conditions`,
    }];
  }

  return [{
    path,
    operator: 'every',
    expected: conditions,
    actual: `${failures.length} assertion(s) failed`,
    passed: false,
    message: `${path}: 'every' failed — ${failures.map(f => f.message).join('; ')}`,
  }];
}

/**
 * Array `some` assertion — at least one item must satisfy all conditions.
 *
 * @example
 * ```yaml
 * items:
 *   some:
 *     role: "admin"
 * ```
 */
function assertSome(
  actual: unknown,
  conditions: Record<string, unknown>,
  path: string,
): AssertionResult[] {
  if (!Array.isArray(actual)) {
    return [{
      path,
      operator: 'some',
      expected: 'array',
      actual: actual === null ? 'null' : typeof actual,
      passed: false,
      message: `Expected ${path} to be an array for 'some' assertion, got ${actual === null ? 'null' : typeof actual}`,
    }];
  }

  if (actual.length === 0) {
    return [{
      path,
      operator: 'some',
      expected: conditions,
      actual: [],
      passed: false,
      message: `${path} is empty — 'some' fails (no items to match)`,
    }];
  }

  for (let i = 0; i < actual.length; i++) {
    const item = actual[i];
    const itemPath = `${path}[${i}]`;

    let itemResults: AssertionResult[];
    if (item === null || item === undefined || typeof item !== 'object' || Array.isArray(item)) {
      itemResults = evaluateAssertion(item, conditions, itemPath);
    } else {
      itemResults = assertBody(item, conditions, itemPath);
    }

    if (itemResults.every(r => r.passed)) {
      return [{
        path,
        operator: 'some',
        expected: conditions,
        actual: `item [${i}] matched`,
        passed: true,
        message: `${path}: item [${i}] satisfies 'some' conditions`,
      }];
    }
  }

  return [{
    path,
    operator: 'some',
    expected: conditions,
    actual: `none of ${actual.length} items matched`,
    passed: false,
    message: `${path}: 'some' failed — none of the ${actual.length} items satisfy all conditions`,
  }];
}

/**
 * Negation wrapper — inverts assertion results.
 *
 * @example
 * ```yaml
 * status:
 *   not:
 *     in: [500, 502, 503]
 *
 * name:
 *   not: "forbidden_value"
 * ```
 */
function assertNot(
  actual: unknown,
  expected: unknown,
  path: string,
): AssertionResult[] {
  const innerResults = evaluateAssertion(actual, expected, path);

  return innerResults.map(r => ({
    ...r,
    operator: `not(${r.operator})`,
    passed: !r.passed,
    message: !r.passed
      ? r.message
      : `NOT: expected ${path} to NOT satisfy: ${r.message}`,
  }));
}

// =====================================================================
// Utility Helpers
// =====================================================================

/**
 * Get a nested value from an object by key.
 * Supports simple keys only (not dot-separated paths).
 */
function getNestedValue(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return undefined;
  }
  return (obj as Record<string, unknown>)[key];
}

// =====================================================================
// File Assertions (generic — any agent workspace)
// =====================================================================

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
      message: passed ? 'File content matches exactly' : 'File content mismatch',
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
 * Assert JSON file fields using dot-notation keys.
 *
 * Supported expected value forms:
 * - Primitive → exact match
 * - `'$exists'` → field must be non-null/undefined
 * - `{ gt: number }` → numeric greater-than
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

// =====================================================================
// LLM-as-Judge (generic — any agent transcript)
// =====================================================================

export interface JudgeOptions {
  /** The original goal/task given to the agent */
  goal: string;
  /** The session transcript (array of messages) */
  transcript: Array<{ role: string; content: string; tool_calls?: unknown[] }>;
  /** Final workspace state description (e.g., file listing) */
  workspaceState?: string;
  /** LLM API base URL (default: https://api.deepseek.com/v1) */
  apiBase?: string;
  /** LLM API key */
  apiKey?: string;
  /** Model to use for judging (default: deepseek-chat) */
  model?: string;
  /** Custom judge prompt (overrides default) */
  customPrompt?: string;
}

export interface JudgeResult {
  /** Whether the agent completed the task goal */
  completed: boolean;
  /** Quality score 1-5 */
  score: number;
  /** Whether there were obvious issues (loops, errors, wasted steps) */
  hasIssues: boolean;
  /** Free-text explanation from the judge */
  reason: string;
  /** Raw judge response (for debugging) */
  raw: string;
}

const DEFAULT_JUDGE_PROMPT = `You are an impartial evaluator assessing whether an AI agent successfully completed its assigned task.

## Task Goal
{goal}

## Agent Transcript
{transcript}

{workspace_section}

## Evaluation Criteria
1. **Completion**: Did the agent achieve the stated goal?
2. **Efficiency**: Were there unnecessary loops, errors, or wasted steps?
3. **Quality**: Is the output correct and complete?

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "completed": true/false,
  "score": 1-5,
  "has_issues": true/false,
  "reason": "1-2 sentence explanation"
}

Score guide:
- 5: Perfect execution, goal fully achieved efficiently
- 4: Goal achieved with minor inefficiencies
- 3: Goal partially achieved or achieved with significant issues
- 2: Goal mostly not achieved but showed progress
- 1: Complete failure or stuck in loops`;

/**
 * Use an LLM to judge agent behavior semantically.
 *
 * This is a Tier-2 assertion: more expensive than programmatic checks but
 * handles open-ended tasks where rule-based assertions cannot determine
 * semantic correctness.
 *
 * @param options - Judge configuration and input
 * @returns Structured evaluation result
 */
export async function judgeLlm(options: JudgeOptions): Promise<JudgeResult> {
  const apiBase = options.apiBase ?? process.env['JUDGE_API_BASE'] ?? 'https://api.deepseek.com/v1';
  const apiKey = options.apiKey ?? process.env['JUDGE_API_KEY'] ?? process.env['DEEPSEEK_API_KEY'];
  const model = options.model ?? process.env['JUDGE_MODEL'] ?? 'deepseek-chat';

  if (!apiKey) {
    throw new Error('LLM judge requires an API key (set JUDGE_API_KEY or DEEPSEEK_API_KEY)');
  }

  const transcriptText = options.transcript
    .map((msg, i) => {
      const toolInfo = msg.tool_calls?.length
        ? ` [calls: ${(msg.tool_calls as Array<{ name?: string }>).map(t => t.name ?? '?').join(', ')}]`
        : '';
      const content = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
      return `[${i}] ${msg.role}${toolInfo}: ${content}`;
    })
    .join('\n');

  const workspaceSection = options.workspaceState
    ? `## Workspace State After Execution\n${options.workspaceState}`
    : '';

  const prompt = (options.customPrompt ?? DEFAULT_JUDGE_PROMPT)
    .replace('{goal}', options.goal)
    .replace('{transcript}', transcriptText)
    .replace('{workspace_section}', workspaceSection);

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge LLM call failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { completed: false, score: 0, hasIssues: true, reason: 'Judge returned non-JSON response', raw };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      completed?: boolean;
      score?: number;
      has_issues?: boolean;
      reason?: string;
    };

    return {
      completed: parsed.completed ?? false,
      score: parsed.score ?? 0,
      hasIssues: parsed.has_issues ?? true,
      reason: parsed.reason ?? 'No reason provided',
      raw,
    };
  } catch {
    return { completed: false, score: 0, hasIssues: true, reason: `Failed to parse judge response: ${raw}`, raw };
  }
}

/**
 * Deep equality check for assertion comparison.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
