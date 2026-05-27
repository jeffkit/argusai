import { eq, and, gte, desc } from 'drizzle-orm';
import type { NotificationChannel, NotificationMessage, NotificationConfig, RunSummary, CaseSummary } from './types.js';
import { WeComNotifier } from './wecom.js';

/**
 * Evaluates notification triggers after a sync event and dispatches messages.
 * All operations are fire-and-forget — errors are logged, never thrown.
 */
export class NotificationTrigger {
  constructor(private db: any, private schema: any) {}

  async evaluateAndSend(
    teamId: string,
    teamName: string,
    run: RunSummary,
    cases: CaseSummary[],
    config: NotificationConfig,
  ): Promise<string[]> {
    const triggered: string[] = [];

    if (!config.webhookUrl) return triggered;

    const channel = new WeComNotifier(config.webhookUrl);

    try {
      if (config.onFailure && run.status === 'failed') {
        const failedCases = cases.filter((c) => c.status === 'failed');
        const message: NotificationMessage = {
          type: 'failure',
          teamName,
          project: run.project,
          run,
          failedCases,
        };
        await channel.send(message);
        triggered.push('failure');
      }

      if (config.onSuccess && run.status === 'passed') {
        const message: NotificationMessage = {
          type: 'success',
          teamName,
          project: run.project,
          run,
        };
        await channel.send(message);
        triggered.push('success');
      }

      if (config.onNewFlaky) {
        const newFlaky = await this.detectNewFlaky(teamId, run.project, cases);
        if (newFlaky.length > 0) {
          const message: NotificationMessage = {
            type: 'newFlaky',
            teamName,
            project: run.project,
            run,
            newFlakyCases: newFlaky,
          };
          await channel.send(message);
          triggered.push('newFlaky');
        }
      }
    } catch (err) {
      console.warn(`[notification] Trigger error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return triggered;
  }

  async sendDailyDigest(teamId: string, teamName: string, config: NotificationConfig): Promise<void> {
    if (!config.webhookUrl || !config.dailyDigest) return;

    try {
      const channel = new WeComNotifier(config.webhookUrl);
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

      const runs = this.dbAll(
        this.db.select().from(this.schema.testRuns).where(
          and(eq(this.schema.testRuns.teamId, teamId), gte(this.schema.testRuns.timestamp, cutoffMs)),
        ),
      );

      let totalPassed = 0;
      let totalFailed = 0;
      for (const r of runs) {
        totalPassed += r.passed ?? 0;
        totalFailed += r.failed ?? 0;
      }

      const passRate = totalPassed + totalFailed > 0
        ? Math.round((totalPassed / (totalPassed + totalFailed)) * 1000) / 10
        : 100;

      const latestRun = runs[runs.length - 1];
      if (!latestRun) return;

      const message: NotificationMessage = {
        type: 'digest',
        teamName,
        project: 'all-projects',
        run: {
          id: 'digest',
          project: 'all-projects',
          timestamp: Date.now(),
          passed: totalPassed,
          failed: totalFailed,
          skipped: 0,
          flaky: 0,
          status: totalFailed > 0 ? 'failed' : 'passed',
          duration: 0,
        },
        digestStats: {
          totalRuns: runs.length,
          totalPassed,
          totalFailed,
          passRate,
          period: `${new Date(cutoffMs).toISOString().split('T')[0]} ~ ${new Date().toISOString().split('T')[0]}`,
        },
      };

      await channel.send(message);
    } catch (err) {
      console.warn(`[notification] Digest error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Detect cases that newly crossed the flaky threshold by comparing the
   * latest run's results against the previous 10 runs.
   */
  private async detectNewFlaky(
    teamId: string,
    project: string,
    currentCases: CaseSummary[],
  ): Promise<Array<{ caseName: string; suiteId: string; score: number }>> {
    const FLAKY_THRESHOLD = 0.2;
    const ANALYSIS_WINDOW = 10;

    const recentRuns = this.dbAll(
      this.db.select().from(this.schema.testRuns).where(
        and(eq(this.schema.testRuns.teamId, teamId), eq(this.schema.testRuns.project, project)),
      ).orderBy(desc(this.schema.testRuns.timestamp)).limit(ANALYSIS_WINDOW + 1),
    );

    if (recentRuns.length < 3) return [];

    const prevRunIds = recentRuns.slice(1).map((r: any) => r.id);
    const caseResults = new Map<string, { passed: number; failed: number; suiteId: string }>();

    for (const runId of prevRunIds) {
      const cases = this.dbAll(
        this.db.select().from(this.schema.testCaseRuns).where(eq(this.schema.testCaseRuns.runId, runId)),
      );
      for (const c of cases) {
        const key = c.caseName as string;
        const entry = caseResults.get(key) ?? { passed: 0, failed: 0, suiteId: c.suiteId as string };
        if (c.status === 'passed') entry.passed++;
        if (c.status === 'failed') entry.failed++;
        caseResults.set(key, entry);
      }
    }

    const newFlaky: Array<{ caseName: string; suiteId: string; score: number }> = [];

    for (const currentCase of currentCases) {
      if (currentCase.status !== 'failed') continue;

      const prev = caseResults.get(currentCase.caseName);
      if (!prev) continue;

      const total = prev.passed + prev.failed + 1;
      const failures = prev.failed + 1;
      const score = Math.round((failures / total) * 100) / 100;

      const prevScore = prev.passed + prev.failed > 0
        ? prev.failed / (prev.passed + prev.failed)
        : 0;

      if (score >= FLAKY_THRESHOLD && prevScore < FLAKY_THRESHOLD) {
        newFlaky.push({ caseName: currentCase.caseName, suiteId: currentCase.suiteId, score });
      }
    }

    return newFlaky;
  }

  private dbAll(query: any): any[] {
    return query.all?.() ?? query;
  }
}
