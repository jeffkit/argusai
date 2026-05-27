import { eq, and, gte, lte, desc, asc, sql, count } from 'drizzle-orm';
import type { TestRunRecord, TestCaseRunRecord, TriggerSource } from '../history/types.js';
import type { HistoryStore, GetRunsOptions, GetRunsResult } from '../history/history-store.js';
import type { SqliteDb } from './create-db.js';
import { testRuns, testCaseRuns } from './schema-sqlite.js';

/**
 * HistoryStore implementation backed by Drizzle ORM.
 * Works with any Drizzle instance wrapping a SQLite database (local mode).
 * For server mode with PG/MySQL, the same query patterns apply through
 * Drizzle's dialect-agnostic API.
 */
export class DrizzleHistoryStore implements HistoryStore {
  constructor(private db: SqliteDb) {}

  saveRun(run: TestRunRecord, cases: TestCaseRunRecord[]): void {
    const createdAt = new Date(run.timestamp).toISOString();

    this.db.transaction((tx) => {
      tx.insert(testRuns).values({
        id: run.id,
        project: run.project,
        timestamp: run.timestamp,
        gitCommit: run.gitCommit,
        gitBranch: run.gitBranch,
        configHash: run.configHash,
        trigger: run.trigger,
        duration: run.duration,
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        flaky: run.flaky,
        status: run.status,
        createdAt,
      }).run();

      for (const c of cases) {
        tx.insert(testCaseRuns).values({
          id: c.id,
          runId: c.runId,
          suiteId: c.suiteId,
          caseName: c.caseName,
          status: c.status,
          duration: c.duration,
          attempts: c.attempts,
          responseMs: c.responseMs,
          assertions: c.assertions,
          error: c.error ? c.error.slice(0, 2000) : null,
          snapshot: c.snapshot,
          createdAt,
        }).run();
      }
    });
  }

  getRuns(project: string, options: GetRunsOptions): GetRunsResult {
    const conditions = [eq(testRuns.project, project)];

    if (options.status) {
      conditions.push(eq(testRuns.status, options.status));
    }
    if (options.days) {
      const cutoffMs = Date.now() - options.days * 24 * 60 * 60 * 1000;
      conditions.push(gte(testRuns.timestamp, cutoffMs));
    }

    const where = and(...conditions);

    const countResult = this.db
      .select({ cnt: count() })
      .from(testRuns)
      .where(where)
      .get();
    const total = countResult?.cnt ?? 0;

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = options.offset ?? 0;

    const rows = this.db
      .select()
      .from(testRuns)
      .where(where)
      .orderBy(desc(testRuns.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    return {
      runs: rows.map(mapDrizzleRunRow),
      total,
    };
  }

  getRunById(id: string): { run: TestRunRecord; cases: TestCaseRunRecord[] } | null {
    const runRow = this.db
      .select()
      .from(testRuns)
      .where(eq(testRuns.id, id))
      .get();

    if (!runRow) return null;

    const caseRows = this.db
      .select()
      .from(testCaseRuns)
      .where(eq(testCaseRuns.runId, id))
      .orderBy(asc(testCaseRuns.createdAt))
      .all();

    return {
      run: mapDrizzleRunRow(runRow),
      cases: caseRows.map(mapDrizzleCaseRow),
    };
  }

  getCaseHistory(caseName: string, project: string, limit: number, suiteId?: string): TestCaseRunRecord[] {
    const conditions = [
      eq(testCaseRuns.caseName, caseName),
      eq(testRuns.project, project),
    ];

    if (suiteId) {
      conditions.push(eq(testCaseRuns.suiteId, suiteId));
    }

    const rows = this.db
      .select({
        id: testCaseRuns.id,
        runId: testCaseRuns.runId,
        suiteId: testCaseRuns.suiteId,
        caseName: testCaseRuns.caseName,
        status: testCaseRuns.status,
        duration: testCaseRuns.duration,
        attempts: testCaseRuns.attempts,
        responseMs: testCaseRuns.responseMs,
        assertions: testCaseRuns.assertions,
        error: testCaseRuns.error,
        snapshot: testCaseRuns.snapshot,
        createdAt: testCaseRuns.createdAt,
      })
      .from(testCaseRuns)
      .innerJoin(testRuns, eq(testCaseRuns.runId, testRuns.id))
      .where(and(...conditions))
      .orderBy(desc(testRuns.timestamp))
      .limit(limit)
      .all();

    return rows.map(mapDrizzleCaseRow);
  }

  getRunsInDateRange(project: string, fromMs: number, toMs: number): TestRunRecord[] {
    const rows = this.db
      .select()
      .from(testRuns)
      .where(
        and(
          eq(testRuns.project, project),
          gte(testRuns.timestamp, fromMs),
          lte(testRuns.timestamp, toMs),
        ),
      )
      .orderBy(asc(testRuns.timestamp))
      .all();

    return rows.map(mapDrizzleRunRow);
  }

  getCasesForRun(runId: string): TestCaseRunRecord[] {
    const rows = this.db
      .select()
      .from(testCaseRuns)
      .where(eq(testCaseRuns.runId, runId))
      .orderBy(asc(testCaseRuns.createdAt))
      .all();

    return rows.map(mapDrizzleCaseRow);
  }

  getDistinctCaseNames(project: string, options?: { suiteId?: string; limit?: number }): string[] {
    const conditions = [eq(testRuns.project, project)];

    if (options?.suiteId) {
      conditions.push(eq(testCaseRuns.suiteId, options.suiteId));
    }

    let query = this.db
      .selectDistinct({ caseName: testCaseRuns.caseName })
      .from(testCaseRuns)
      .innerJoin(testRuns, eq(testCaseRuns.runId, testRuns.id))
      .where(and(...conditions))
      .orderBy(asc(testCaseRuns.caseName))
      .$dynamic();

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const rows = query.all();
    return rows.map((r) => r.caseName);
  }

  cleanup(project: string, maxAge: string, maxRuns: number): number {
    let totalDeleted = 0;

    const daysMatch = maxAge.match(/^(\d+)d$/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]!, 10);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const result = this.db
        .delete(testRuns)
        .where(and(eq(testRuns.project, project), sql`${testRuns.timestamp} < ${cutoffMs}`))
        .run();
      totalDeleted += result.changes;
    }

    const countResult = this.db
      .select({ cnt: count() })
      .from(testRuns)
      .where(eq(testRuns.project, project))
      .get();

    const currentCount = countResult?.cnt ?? 0;
    if (currentCount > maxRuns) {
      const excess = currentCount - maxRuns;
      const oldestIds = this.db
        .select({ id: testRuns.id })
        .from(testRuns)
        .where(eq(testRuns.project, project))
        .orderBy(asc(testRuns.timestamp))
        .limit(excess)
        .all()
        .map((r) => r.id);

      if (oldestIds.length > 0) {
        for (const id of oldestIds) {
          this.db.delete(testRuns).where(eq(testRuns.id, id)).run();
        }
        totalDeleted += oldestIds.length;
      }
    }

    return totalDeleted;
  }

  close(): void {
    // The underlying database is managed externally (by the factory).
  }
}

// =====================================================================
// Row Mapping Helpers
// =====================================================================

type DrizzleRunRow = typeof testRuns.$inferSelect;
type DrizzleCaseRow = typeof testCaseRuns.$inferSelect;

function mapDrizzleRunRow(row: DrizzleRunRow): TestRunRecord {
  return {
    id: row.id,
    project: row.project,
    timestamp: row.timestamp,
    gitCommit: row.gitCommit,
    gitBranch: row.gitBranch,
    configHash: row.configHash,
    trigger: row.trigger as TriggerSource,
    duration: row.duration,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    flaky: row.flaky,
    status: row.status as 'passed' | 'failed',
  };
}

function mapDrizzleCaseRow(row: DrizzleCaseRow | Pick<DrizzleCaseRow, 'id' | 'runId' | 'suiteId' | 'caseName' | 'status' | 'duration' | 'attempts' | 'responseMs' | 'assertions' | 'error' | 'snapshot'>): TestCaseRunRecord {
  return {
    id: row.id,
    runId: row.runId,
    suiteId: row.suiteId,
    caseName: row.caseName,
    status: row.status as 'passed' | 'failed' | 'skipped',
    duration: row.duration,
    attempts: row.attempts,
    responseMs: row.responseMs,
    assertions: row.assertions,
    error: row.error,
    snapshot: row.snapshot,
  };
}
