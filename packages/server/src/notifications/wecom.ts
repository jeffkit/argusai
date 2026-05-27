import type { NotificationChannel, NotificationMessage, CaseSummary } from './types.js';

const MAX_MESSAGES_PER_MINUTE = 18;
const RATE_WINDOW_MS = 60_000;
const COALESCE_WINDOW_MS = 10_000;
const SEND_TIMEOUT_MS = 5_000;
const MAX_FAILED_CASES_SHOWN = 10;

interface PendingCoalesce {
  timer: ReturnType<typeof setTimeout>;
  messages: NotificationMessage[];
}

/**
 * Enterprise WeChat (企微) webhook notification channel.
 * Rate-limited to 18 msg/min per webhook, with 10s coalescing window.
 */
export class WeComNotifier implements NotificationChannel {
  private sendTimestamps = new Map<string, number[]>();
  private pendingCoalesce = new Map<string, PendingCoalesce>();

  constructor(private webhookUrl: string) {}

  async send(message: NotificationMessage): Promise<void> {
    try {
      const pending = this.pendingCoalesce.get(this.webhookUrl);
      if (pending) {
        pending.messages.push(message);
        return;
      }

      const coalesce: PendingCoalesce = {
        messages: [message],
        timer: setTimeout(() => {
          this.pendingCoalesce.delete(this.webhookUrl);
          this.flushMessages(coalesce.messages).catch((err) => {
            console.warn(`[wecom] Flush error: ${err instanceof Error ? err.message : String(err)}`);
          });
        }, COALESCE_WINDOW_MS),
      };
      this.pendingCoalesce.set(this.webhookUrl, coalesce);
    } catch (err) {
      console.warn(`[wecom] Send error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async flushMessages(messages: NotificationMessage[]): Promise<void> {
    if (messages.length === 0) return;

    if (messages.length === 1) {
      await this.sendSingle(messages[0]!);
      return;
    }

    const merged = this.mergeMessages(messages);
    await this.sendSingle(merged);
  }

  private mergeMessages(messages: NotificationMessage[]): NotificationMessage {
    const first = messages[0]!;
    const allFailed: CaseSummary[] = [];
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalFlaky = 0;

    for (const msg of messages) {
      totalPassed += msg.run.passed;
      totalFailed += msg.run.failed;
      totalSkipped += msg.run.skipped;
      totalFlaky += msg.run.flaky;
      if (msg.failedCases) {
        allFailed.push(...msg.failedCases);
      }
    }

    return {
      ...first,
      run: {
        ...first.run,
        passed: totalPassed,
        failed: totalFailed,
        skipped: totalSkipped,
        flaky: totalFlaky,
      },
      failedCases: allFailed.slice(0, MAX_FAILED_CASES_SHOWN),
    };
  }

  private async sendSingle(message: NotificationMessage): Promise<void> {
    await this.waitForRateLimit(this.webhookUrl);

    const content = formatMessage(message);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      this.recordSend(this.webhookUrl);

      if (!response.ok) {
        console.warn(`[wecom] Webhook returned ${response.status}: ${await response.text().catch(() => 'no body')}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[wecom] Webhook request timed out');
      } else {
        console.warn(`[wecom] Webhook error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async waitForRateLimit(url: string): Promise<void> {
    const now = Date.now();
    const timestamps = this.sendTimestamps.get(url) ?? [];
    const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
    this.sendTimestamps.set(url, recent);

    if (recent.length >= MAX_MESSAGES_PER_MINUTE) {
      const oldestInWindow = recent[0]!;
      const waitMs = RATE_WINDOW_MS - (now - oldestInWindow) + 100;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  private recordSend(url: string): void {
    const timestamps = this.sendTimestamps.get(url) ?? [];
    timestamps.push(Date.now());
    this.sendTimestamps.set(url, timestamps);
  }
}

export function formatMessage(message: NotificationMessage): string {
  const lines: string[] = [];

  switch (message.type) {
    case 'failure':
      lines.push('**ArgusAI 测试失败通知**');
      break;
    case 'success':
      lines.push('**ArgusAI 测试通过通知**');
      break;
    case 'newFlaky':
      lines.push('**ArgusAI 新增 Flaky 测试警告**');
      break;
    case 'digest':
      lines.push('**ArgusAI 每日测试摘要**');
      break;
  }

  lines.push('');
  lines.push(`> 项目: **${message.project}**`);
  lines.push(`> 团队: ${message.teamName}`);
  lines.push(`> 运行时间: ${new Date(message.run.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  if (message.run.sourceDeveloper) {
    lines.push(`> 开发者: ${message.run.sourceDeveloper}`);
  }

  lines.push('');
  lines.push('**结果摘要**');
  lines.push(`通过: ${message.run.passed} | 失败: ${message.run.failed} | 跳过: ${message.run.skipped} | Flaky: ${message.run.flaky}`);

  if (message.failedCases && message.failedCases.length > 0) {
    lines.push('');
    lines.push('**失败用例**');
    for (let i = 0; i < Math.min(message.failedCases.length, MAX_FAILED_CASES_SHOWN); i++) {
      const c = message.failedCases[i]!;
      const errorSnippet = c.error ? ` — ${c.error.slice(0, 80)}` : '';
      lines.push(`${i + 1}. ${c.caseName}${errorSnippet}`);
    }
    if (message.failedCases.length > MAX_FAILED_CASES_SHOWN) {
      lines.push(`... 还有 ${message.failedCases.length - MAX_FAILED_CASES_SHOWN} 个失败用例`);
    }
  }

  if (message.newFlakyCases && message.newFlakyCases.length > 0) {
    lines.push('');
    lines.push('**新增 Flaky 用例**');
    for (const c of message.newFlakyCases) {
      lines.push(`- ${c.caseName} (score: ${c.score})`);
    }
  }

  if (message.digestStats) {
    lines.push('');
    lines.push('**每日统计**');
    lines.push(`总运行次数: ${message.digestStats.totalRuns}`);
    lines.push(`通过率: ${message.digestStats.passRate}%`);
    lines.push(`统计周期: ${message.digestStats.period}`);
  }

  if (message.dashboardUrl) {
    lines.push('');
    lines.push(`[查看 Dashboard](${message.dashboardUrl})`);
  }

  return lines.join('\n');
}
