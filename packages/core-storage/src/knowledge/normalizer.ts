/**
 * @module knowledge/normalizer
 * Error normalization pipeline and deterministic signature generation.
 * Strips dynamic values (UUIDs, timestamps, IPs, etc.) to create stable
 * error fingerprints for knowledge base matching.
 */

import { createHash } from 'node:crypto';
import type { FailureCategory } from './types.js';

interface NormalizationRule {
  pattern: RegExp;
  replacement: string | ((...args: string[]) => string);
}

const NORMALIZATION_RULES: NormalizationRule[] = [
  // 1. UUID v4
  {
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    replacement: '<UUID>',
  },
  // 2. ISO timestamps
  {
    pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\d.]*Z?/g,
    replacement: '<TIMESTAMP>',
  },
  // 3. IP addresses
  {
    pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g,
    replacement: '<IP>',
  },
  // 4. Port numbers (in context: followed by /, whitespace, comma, ), ])
  {
    pattern: /:(\d{2,5})(?=[/\s,)\]])/g,
    replacement: ':<PORT>',
  },
  // 5. Hex hashes (8+ hex chars within path separators)
  {
    pattern: /\/[a-f0-9]{8,}\//gi,
    replacement: '/<HASH>/',
  },
  // 6. HTTP status codes (3-digit numbers in HTTP context)
  {
    pattern: /\b([45])\d{2}\b/g,
    replacement: (_match: string, prefix: string) => `${prefix}xx`,
  },
  // 7. Path segments with numeric IDs
  {
    pattern: /(\/\w+)\/\d+/g,
    replacement: '$1/<ID>',
  },
  // 8. Standalone large numbers (4+ digits)
  {
    pattern: /\b\d{4,}\b/g,
    replacement: '<NUM>',
  },
];

/**
 * Normalize a raw error string by replacing dynamic values with placeholders.
 * Applies 8 ordered regex replacements per data-model normalization rules.
 */
export function normalizeError(error: string): string {
  let result = error;
  for (const rule of NORMALIZATION_RULES) {
    if (typeof rule.replacement === 'function') {
      result = result.replace(rule.pattern, rule.replacement);
    } else {
      result = result.replace(rule.pattern, rule.replacement);
    }
  }
  return result;
}

/**
 * Generate a deterministic signature for a failure event.
 * @returns Both the SHA-256 hash (signature) and the human-readable pattern string (signaturePattern).
 */
export function generateSignature(
  category: FailureCategory,
  caseName: string,
  error: string,
): { signature: string; signaturePattern: string } {
  const normalizedError = normalizeError(error);
  const signaturePattern = `${category}::${caseName}::${normalizedError}`;
  const signature = createHash('sha256').update(signaturePattern).digest('hex');
  return { signature, signaturePattern };
}
