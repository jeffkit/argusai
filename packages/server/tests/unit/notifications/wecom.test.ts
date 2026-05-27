import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeComNotifier, formatMessage } from '../../../src/notifications/wecom.js';
import type { NotificationMessage } from '../../../src/notifications/types.js';

function makeMessage(overrides?: Partial<NotificationMessage>): NotificationMessage {
  return {
    type: 'failure',
    teamName: 'test-team',
    project: 'my-project',
    run: {
      id: 'run-1',
      project: 'my-project',
      timestamp: Date.now(),
      passed: 18,
      failed: 2,
      skipped: 1,
      flaky: 1,
      status: 'failed',
      duration: 45000,
      sourceDeveloper: 'dev-a',
    },
    failedCases: [
      { caseName: 'health-check', suiteId: 'api', status: 'failed', error: 'Connection refused', duration: 1000 },
      { caseName: 'payment-flow', suiteId: 'api', status: 'failed', error: 'Expected 200, got 500', duration: 2000 },
    ],
    ...overrides,
  };
}

describe('WeComNotifier', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('ok') });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends markdown message to webhook after coalesce window', async () => {
    vi.useFakeTimers();
    const notifier = new WeComNotifier('https://qyapi.weixin.qq.com/test');
    const message = makeMessage();

    await notifier.send(message);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(11_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://qyapi.weixin.qq.com/test');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.content).toContain('测试失败通知');
    expect(body.markdown.content).toContain('my-project');
    vi.useRealTimers();
  });

  it('coalesces multiple messages within window', async () => {
    vi.useFakeTimers();
    const notifier = new WeComNotifier('https://qyapi.weixin.qq.com/test');

    await notifier.send(makeMessage());
    await notifier.send(makeMessage({ project: 'second-project' }));

    await vi.advanceTimersByTimeAsync(11_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('handles fetch errors gracefully', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('network error'));
    const notifier = new WeComNotifier('https://qyapi.weixin.qq.com/test');

    await notifier.send(makeMessage());
    await vi.advanceTimersByTimeAsync(11_000);

    // Should not throw
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('formatMessage', () => {
  it('formats failure notification', () => {
    const msg = makeMessage();
    const content = formatMessage(msg);

    expect(content).toContain('测试失败通知');
    expect(content).toContain('my-project');
    expect(content).toContain('test-team');
    expect(content).toContain('通过: 18');
    expect(content).toContain('失败: 2');
    expect(content).toContain('health-check');
    expect(content).toContain('payment-flow');
  });

  it('formats success notification', () => {
    const msg = makeMessage({ type: 'success' });
    msg.run.status = 'passed';
    msg.failedCases = [];
    const content = formatMessage(msg);
    expect(content).toContain('测试通过通知');
  });

  it('formats newFlaky notification', () => {
    const msg = makeMessage({
      type: 'newFlaky',
      newFlakyCases: [{ caseName: 'flaky-test', suiteId: 'api', score: 0.3 }],
    });
    const content = formatMessage(msg);
    expect(content).toContain('Flaky 测试警告');
    expect(content).toContain('flaky-test');
    expect(content).toContain('0.3');
  });

  it('formats digest notification', () => {
    const msg = makeMessage({
      type: 'digest',
      digestStats: {
        totalRuns: 50,
        totalPassed: 900,
        totalFailed: 100,
        passRate: 90.0,
        period: '2026-03-08 ~ 2026-03-09',
      },
    });
    const content = formatMessage(msg);
    expect(content).toContain('每日测试摘要');
    expect(content).toContain('50');
    expect(content).toContain('90');
  });

  it('truncates failed cases to 10', () => {
    const cases = Array.from({ length: 15 }, (_, i) => ({
      caseName: `case-${i}`,
      suiteId: 'api',
      status: 'failed' as const,
      error: `Error ${i}`,
      duration: 1000,
    }));
    const msg = makeMessage({ failedCases: cases });
    const content = formatMessage(msg);
    expect(content).toContain('case-9');
    expect(content).not.toContain('case-10');
    expect(content).toContain('还有 5 个失败用例');
  });

  it('includes dashboard URL when provided', () => {
    const msg = makeMessage({ dashboardUrl: 'https://dashboard.example.com' });
    const content = formatMessage(msg);
    expect(content).toContain('https://dashboard.example.com');
  });
});
