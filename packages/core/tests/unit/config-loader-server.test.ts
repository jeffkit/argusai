import { describe, it, expect } from 'vitest';
import { E2EConfigSchema, ServerConfigSchema } from '../../src/config-loader.js';

describe('ServerConfigSchema', () => {
  it('should be undefined when server section is omitted', () => {
    const config = E2EConfigSchema.parse({
      project: { name: 'test-project' },
    });
    expect(config.server).toBeUndefined();
  });

  it('should parse valid server section', () => {
    const config = E2EConfigSchema.parse({
      project: { name: 'test-project' },
      server: {
        url: 'https://argusai.example.com',
        apiKey: 'abc123',
        team: 'my-team',
      },
    });
    expect(config.server).toBeDefined();
    expect(config.server!.url).toBe('https://argusai.example.com');
    expect(config.server!.apiKey).toBe('abc123');
    expect(config.server!.team).toBe('my-team');
    expect(config.server!.sync).toBe('auto');
  });

  it('should default sync to auto', () => {
    const result = ServerConfigSchema.parse({
      url: 'https://argusai.example.com',
      apiKey: 'abc123',
      team: 'my-team',
    });
    expect(result!.sync).toBe('auto');
  });

  it('should accept valid sync modes', () => {
    for (const mode of ['auto', 'manual', 'disabled']) {
      const result = ServerConfigSchema.parse({
        url: 'https://argusai.example.com',
        apiKey: 'key',
        team: 'team',
        sync: mode,
      });
      expect(result!.sync).toBe(mode);
    }
  });

  it('should reject invalid sync mode', () => {
    expect(() =>
      ServerConfigSchema.parse({
        url: 'https://argusai.example.com',
        apiKey: 'key',
        team: 'team',
        sync: 'invalid',
      }),
    ).toThrow();
  });

  it('should reject missing url', () => {
    expect(() =>
      ServerConfigSchema.parse({
        apiKey: 'key',
        team: 'team',
      }),
    ).toThrow();
  });

  it('should reject invalid url', () => {
    expect(() =>
      ServerConfigSchema.parse({
        url: 'not-a-url',
        apiKey: 'key',
        team: 'team',
      }),
    ).toThrow();
  });

  it('should reject team name with special chars', () => {
    expect(() =>
      ServerConfigSchema.parse({
        url: 'https://argusai.example.com',
        apiKey: 'key',
        team: 'team with spaces',
      }),
    ).toThrow();
  });

  it('should accept team name with hyphens and underscores', () => {
    const result = ServerConfigSchema.parse({
      url: 'https://argusai.example.com',
      apiKey: 'key',
      team: 'my-team_123',
    });
    expect(result!.team).toBe('my-team_123');
  });

  it('should return undefined when ServerConfigSchema parses undefined', () => {
    const result = ServerConfigSchema.parse(undefined);
    expect(result).toBeUndefined();
  });
});
