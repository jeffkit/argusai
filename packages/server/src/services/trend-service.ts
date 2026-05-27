import { eq, and, gte, desc, asc } from 'drizzle-orm';

export class TrendService {
  constructor(private db: any, private schema: any) {}

  async getPassRateTrend(teamId: string, project: string, days: number): Promise<any[]> {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const runs = await this.getRuns(teamId, project, cutoffMs);

    const byDate = new Map<string, { passed: number; failed: number; skipped: number; count: number }>();

    for (const run of runs) {
      const date = new Date(run.timestamp).toISOString().split('T')[0]!;
      const entry = byDate.get(date) ?? { passed: 0, failed: 0, skipped: 0, count: 0 };
      entry.passed += run.passed;
      entry.failed += run.failed;
      entry.skipped += run.skipped;
      entry.count++;
      byDate.set(date, entry);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        passRate: Math.round((data.passed / Math.max(data.passed + data.failed, 1)) * 1000) / 10,
        passed: data.passed,
        failed: data.failed,
        skipped: data.skipped,
        runCount: data.count,
      }));
  }

  async getDurationTrend(teamId: string, project: string, days: number): Promise<any[]> {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const runs = await this.getRuns(teamId, project, cutoffMs);

    const byDate = new Map<string, number[]>();

    for (const run of runs) {
      const date = new Date(run.timestamp).toISOString().split('T')[0]!;
      const durations = byDate.get(date) ?? [];
      durations.push(run.duration);
      byDate.set(date, durations);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, durations]) => ({
        date,
        avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        runCount: durations.length,
      }));
  }

  async getFlakyRanking(teamId: string, project: string, topN: number): Promise<any[]> {
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const runs = await this.getRuns(teamId, project, cutoffMs);

    if (runs.length === 0) return [];

    const runIds: string[] = runs.map((r: any) => r.id as string);
    const caseMap = new Map<string, { results: string[]; suiteId: string }>();

    for (const runId of runIds) {
      const cases = await this.dbAll(
        this.db.select().from(this.schema.testCaseRuns)
          .where(eq(this.schema.testCaseRuns.runId, runId)),
      );
      for (const c of cases) {
        const key = c.caseName as string;
        const entry = caseMap.get(key) ?? { results: [] as string[], suiteId: c.suiteId as string };
        entry.results.push(c.status as string);
        caseMap.set(key, entry);
      }
    }

    const flaky: any[] = [];
    for (const [caseName, data] of caseMap) {
      const totalRuns = data.results.length;
      if (totalRuns < 2) continue;
      const failCount = data.results.filter((r) => r === 'failed').length;
      const passCount = data.results.filter((r) => r === 'passed').length;
      if (failCount === 0 || passCount === 0) continue;

      const score = Math.round((failCount / totalRuns) * 100) / 100;
      const level = score >= 0.5 ? 'VERY_FLAKY' : score >= 0.2 ? 'FLAKY' : 'MOSTLY_STABLE';

      flaky.push({
        caseName,
        suiteId: data.suiteId,
        score,
        level,
        recentResults: data.results.slice(-10),
        failCount,
        totalRuns,
      });
    }

    return flaky
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  async getFailureTrend(teamId: string, project: string, caseName: string, days: number): Promise<any[]> {
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const runs = await this.getRuns(teamId, project, cutoffMs);

    const dataPoints = [];
    for (const run of runs) {
      const caseRun = await this.dbGet(
        this.db.select().from(this.schema.testCaseRuns).where(
          and(eq(this.schema.testCaseRuns.runId, run.id), eq(this.schema.testCaseRuns.caseName, caseName)),
        ),
      );

      const date = new Date(run.timestamp).toISOString().split('T')[0]!;
      dataPoints.push({
        date,
        status: caseRun?.status ?? 'no-run',
        duration: caseRun?.duration ?? null,
        error: caseRun?.error ?? null,
        runId: run.id,
      });
    }

    return dataPoints;
  }

  private async getRuns(teamId: string, project: string, cutoffMs: number): Promise<any[]> {
    return await this.dbAll(
      this.db.select().from(this.schema.testRuns)
        .where(and(
          eq(this.schema.testRuns.teamId, teamId),
          eq(this.schema.testRuns.project, project),
          gte(this.schema.testRuns.timestamp, cutoffMs),
        ))
        .orderBy(asc(this.schema.testRuns.timestamp)),
    );
  }

  private async dbGet(query: any): Promise<any> {
    if (typeof query.get === 'function') return query.get();
    const rows = await query;
    return Array.isArray(rows) ? rows[0] : rows;
  }

  private async dbAll(query: any): Promise<any[]> {
    if (typeof query.all === 'function') return query.all();
    const rows = await query;
    return Array.isArray(rows) ? rows : [];
  }
}
