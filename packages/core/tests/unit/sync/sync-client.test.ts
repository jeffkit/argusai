import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncClient } from '../../../src/sync/sync-client.js';

describe('SyncClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should send correct headers and body for syncRuns', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url as string;
      capturedInit = init;
      return new Response(JSON.stringify({
        success: true,
        result: {
          runStatus: 'created',
          projectStatus: 'existing',
          casesStored: 5,
          patternsStored: 0,
          patternsDeduped: 0,
          notificationsTriggered: [],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const client = new SyncClient('https://server.example.com', 'my-api-key');
    const payload = {
      project: 'test',
      team: 'team',
      run: { id: '1', timestamp: 1, gitCommit: null, gitBranch: null, configHash: 'h', trigger: 'cli' as const, duration: 0, passed: 1, failed: 0, skipped: 0, flaky: 0, status: 'passed' as const },
      cases: [],
    };

    const result = await client.syncRuns(payload);

    expect(capturedUrl).toBe('https://server.example.com/api/sync/runs');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-API-Key': 'my-api-key',
    });
    expect(result.success).toBe(true);
    expect(result.result.runStatus).toBe('created');
  });

  it('should throw on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid API key',
        code: 'AUTH_INVALID_KEY',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const client = new SyncClient('https://server.example.com', 'bad-key');
    await expect(client.syncRuns({
      project: 'test', team: 'team',
      run: { id: '1', timestamp: 1, gitCommit: null, gitBranch: null, configHash: 'h', trigger: 'cli' as const, duration: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, status: 'passed' as const },
      cases: [],
    })).rejects.toThrow('Invalid API key');
  });

  it('should return true on successful ping', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as any;

    const client = new SyncClient('https://server.example.com', 'key');
    const result = await client.ping();
    expect(result).toBe(true);
  });

  it('should return false on failed ping', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error');
    }) as any;

    const client = new SyncClient('https://server.example.com', 'key');
    const result = await client.ping();
    expect(result).toBe(false);
  });

  it('should strip trailing slashes from base URL', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = url as string;
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as any;

    const client = new SyncClient('https://server.example.com/', 'key');
    await client.ping();
    expect(capturedUrl).toBe('https://server.example.com/api/health');
  });
});
