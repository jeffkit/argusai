import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, validateApiKey } from '../../../src/auth/api-key.js';

describe('API Key Generation', () => {
  it('should generate a 64-char hex key', () => {
    const { rawKey } = generateApiKey();
    expect(rawKey).toHaveLength(64);
    expect(rawKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should generate a deterministic hash', () => {
    const key = 'a'.repeat(64);
    const hash1 = hashApiKey(key);
    const hash2 = hashApiKey(key);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should generate unique keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.rawKey).not.toBe(key2.rawKey);
    expect(key1.hash).not.toBe(key2.hash);
  });

  it('should produce an 8-char prefix', () => {
    const { rawKey, prefix } = generateApiKey();
    expect(prefix).toHaveLength(8);
    expect(rawKey.startsWith(prefix)).toBe(true);
  });

  it('should validate correct key against hash', () => {
    const { rawKey, hash } = generateApiKey();
    expect(validateApiKey(rawKey, hash)).toBe(true);
  });

  it('should reject wrong key against hash', () => {
    const { hash } = generateApiKey();
    expect(validateApiKey('wrong-key', hash)).toBe(false);
  });
});
