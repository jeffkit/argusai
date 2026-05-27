import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationTrigger } from '../../../src/notifications/trigger.js';
import type { NotificationConfig, RunSummary, CaseSummary } from '../../../src/notifications/types.js';

function makeConfig(overrides?: Partial<NotificationConfig>): NotificationConfig {
  return {
    id: 'config-1',
    teamId: 'team-1',
    webhookUrl: 'https://qyapi.weixin.qq.com/test',
    onFailure: true,
    onSuccess: false,
    onNewFlaky: false,
    dailyDigest: false,
    digestTime: '09:00',
    digestTimezone: 'Asia/Shanghai',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRun(overrides?: Partial<RunSummary>): RunSummary {
  return {
    id: 'run-1',
    project: 'test-project',
    timestamp: Date.now(),
    passed: 18,
    failed: 2,
    skipped: 1,
    flaky: 0,
    status: 'failed',
    duration: 45000,
    ...overrides,
  };
}

function makeCases(): CaseSummary[] {
  return [
    { caseName: 'test-a', suiteId: 'api', status: 'passed', duration: 1000 },
    { caseName: 'test-b', suiteId: 'api', status: 'failed', error: 'timeout', duration: 5000 },
  ];
}

describe('NotificationTrigger', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('ok') });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('triggers failure notification when run fails and onFailure is true', async () => {
    const mockDb = { select: vi.fn() };
    const mockSchema = { testRuns: {}, testCaseRuns: {} };
    const trigger = new NotificationTrigger(mockDb, mockSchema);
    const config = makeConfig({ onFailure: true });
    const run = makeRun({ status: 'failed' });

    const triggered = await trigger.evaluateAndSend('team-1', 'test-team', run, makeCases(), config);

    expect(triggered).toContain('failure');
    // Advance past coalesce window
    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('triggers success notification when run passes and onSuccess is true', async () => {
    const mockDb = { select: vi.fn() };
    const mockSchema = { testRuns: {}, testCaseRuns: {} };
    const trigger = new NotificationTrigger(mockDb, mockSchema);
    const config = makeConfig({ onFailure: false, onSuccess: true });
    const run = makeRun({ status: 'passed', failed: 0 });

    const triggered = await trigger.evaluateAndSend('team-1', 'test-team', run, makeCases(), config);

    expect(triggered).toContain('success');
  });

  it('does not trigger when onFailure is false and run fails', async () => {
    const mockDb = { select: vi.fn() };
    const mockSchema = { testRuns: {}, testCaseRuns: {} };
    const trigger = new NotificationTrigger(mockDb, mockSchema);
    const config = makeConfig({ onFailure: false, onSuccess: false });
    const run = makeRun({ status: 'failed' });

    const triggered = await trigger.evaluateAndSend('team-1', 'test-team', run, makeCases(), config);

    expect(triggered).toHaveLength(0);
  });

  it('does not trigger when webhookUrl is null', async () => {
    const mockDb = { select: vi.fn() };
    const mockSchema = { testRuns: {}, testCaseRuns: {} };
    const trigger = new NotificationTrigger(mockDb, mockSchema);
    const config = makeConfig({ webhookUrl: null });
    const run = makeRun();

    const triggered = await trigger.evaluateAndSend('team-1', 'test-team', run, makeCases(), config);

    expect(triggered).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
