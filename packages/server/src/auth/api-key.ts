import { randomBytes, createHash } from 'node:crypto';

export interface GeneratedApiKey {
  rawKey: string;
  hash: string;
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const rawKey = randomBytes(32).toString('hex');
  const hash = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, 8);
  return { rawKey, hash, prefix };
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function validateApiKey(raw: string, hash: string): boolean {
  return hashApiKey(raw) === hash;
}
