/**
 * @module history/config-hash
 * SHA-256 fingerprinting of configuration files.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Compute a SHA-256 hash of the given config file.
 * Returns 'sha256:unknown' if the file cannot be read.
 */
export function computeConfigHash(configPath: string): string {
  try {
    const content = readFileSync(configPath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    return `sha256:${hash}`;
  } catch {
    return 'sha256:unknown';
  }
}
