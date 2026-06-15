/**
 * @module knowledge/classifier
 * FailureClassifier — ordered chain of rules for categorizing test failures.
 * First matching rule wins; unmatched failures are classified as UNKNOWN.
 */

import type { FailureCategory, FailureEvent, ClassificationRule } from './types.js';

export class FailureClassifier {
  private readonly rules: readonly ClassificationRule[];

  constructor(rules: ClassificationRule[]) {
    this.rules = Object.freeze([...rules]);
  }

  classify(event: FailureEvent): FailureCategory {
    for (const rule of this.rules) {
      if (rule.match(event)) {
        return rule.category;
      }
    }
    return 'UNKNOWN';
  }
}

const containsAny = (text: string, patterns: string[]): boolean =>
  patterns.some((p) => text.toLowerCase().includes(p.toLowerCase()));

/** 10 built-in classification rules ordered most-specific-first. */
export const DEFAULT_RULES: ClassificationRule[] = [
  {
    name: 'container-oom',
    category: 'CONTAINER_OOM',
    match: (event) =>
      event.oomKilled || containsAny(event.error, ['OOMKilled']),
  },
  {
    name: 'container-crash',
    category: 'CONTAINER_CRASH',
    match: (event) =>
      !event.oomKilled &&
      event.containerStatus !== null &&
      ['exited', 'dead'].includes(event.containerStatus),
  },
  {
    name: 'connection-refused',
    category: 'CONNECTION_REFUSED',
    match: (event) => containsAny(event.error, ['ECONNREFUSED']),
  },
  {
    name: 'timeout',
    category: 'TIMEOUT',
    match: (event) =>
      containsAny(event.error, ['ETIMEDOUT', 'timeout', 'ESOCKETTIMEDOUT']),
  },
  {
    name: 'network-error',
    category: 'NETWORK_ERROR',
    match: (event) =>
      containsAny(event.error, ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH']),
  },
  {
    name: 'http-5xx',
    category: 'HTTP_ERROR',
    match: (event) =>
      event.status !== null && event.status >= 500 && event.status <= 599,
  },
  {
    name: 'http-4xx',
    category: 'HTTP_ERROR',
    match: (event) =>
      event.status !== null && event.status >= 400 && event.status <= 499,
  },
  {
    name: 'mock-mismatch',
    category: 'MOCK_MISMATCH',
    match: (event) => {
      const lower = event.error.toLowerCase();
      return (
        lower.includes('mock') &&
        (lower.includes('unexpected') || lower.includes('unmatched'))
      );
    },
  },
  {
    name: 'config-error',
    category: 'CONFIG_ERROR',
    match: (event) =>
      containsAny(event.error, ['config', 'YAML', 'validation', 'schema']),
  },
  {
    name: 'assertion-mismatch',
    category: 'ASSERTION_MISMATCH',
    match: (event) =>
      containsAny(event.error, [
        'expected',
        'to equal',
        'to match',
        'AssertionError',
      ]),
  },
];

/** Factory that creates a FailureClassifier pre-loaded with the 10 default rules. */
export function createDefaultClassifier(): FailureClassifier {
  return new FailureClassifier(DEFAULT_RULES);
}
