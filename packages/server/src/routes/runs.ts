import type { FastifyInstance } from 'fastify';
import { eq, and, gte, desc, asc, count } from 'drizzle-orm';

export async function runRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;

  // IMPORTANT: Register /api/runs/compare BEFORE /api/runs/:id to avoid route conflicts

  // GET /api/runs/compare — Compare two runs
  app.get('/api/runs/compare', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { run1, run2 } = request.query as { run1?: string; run2?: string };

    if (!run1 || !run2) {
      return reply.status(400).send({
        success: false,
        error: 'Both run1 and run2 query parameters are required',
        code: 'VALIDATION_ERROR',
      });
    }

    const baseRun = await dbGet(db.select().from(schema.testRuns).where(
      and(eq(schema.testRuns.id, run1), eq(schema.testRuns.teamId, teamId)),
    ));
    const compareRun = await dbGet(db.select().from(schema.testRuns).where(
      and(eq(schema.testRuns.id, run2), eq(schema.testRuns.teamId, teamId)),
    ));

    if (!baseRun || !compareRun) {
      return reply.status(404).send({ success: false, error: 'One or both runs not found', code: 'RUN_NOT_FOUND' });
    }

    const baseCases = await dbAll(db.select().from(schema.testCaseRuns).where(eq(schema.testCaseRuns.runId, run1)));
    const compareCases = await dbAll(db.select().from(schema.testCaseRuns).where(eq(schema.testCaseRuns.runId, run2)));

    const baseMap = new Map(baseCases.map((c: any) => [c.caseName, c]));
    const compareMap = new Map(compareCases.map((c: any) => [c.caseName, c]));

    const newFailures: any[] = [];
    const fixed: any[] = [];
    const consistent = { passed: 0, failed: 0, skipped: 0 };
    const newCases: string[] = [];
    const removedCases: string[] = [];

    for (const [name, caseRun] of compareMap) {
      const baseCase = baseMap.get(name);
      if (!baseCase) {
        newCases.push(name);
        continue;
      }
      if (baseCase.status === 'passed' && caseRun.status === 'failed') {
        newFailures.push({
          caseName: name,
          suiteId: caseRun.suiteId,
          error: caseRun.error,
          baseStatus: baseCase.status,
          compareStatus: caseRun.status,
        });
      } else if (baseCase.status === 'failed' && caseRun.status === 'passed') {
        fixed.push({
          caseName: name,
          suiteId: caseRun.suiteId,
          baseStatus: baseCase.status,
          compareStatus: caseRun.status,
        });
      } else {
        consistent[caseRun.status as keyof typeof consistent]++;
      }
    }

    for (const [name] of baseMap) {
      if (!compareMap.has(name)) {
        removedCases.push(name);
      }
    }

    return {
      success: true,
      baseRun: mapRunResponse(baseRun),
      compareRun: mapRunResponse(compareRun),
      newFailures,
      fixed,
      consistent,
      newCases,
      removedCases,
    };
  });

  // GET /api/runs — List runs
  app.get('/api/runs', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { project, limit = 20, offset = 0, status, days } = request.query as {
      project?: string; limit?: number; offset?: number; status?: string; days?: number;
    };

    if (!project) {
      return reply.status(400).send({
        success: false,
        error: 'project query parameter is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const conditions = [
      eq(schema.testRuns.teamId, teamId),
      eq(schema.testRuns.project, project),
    ];

    if (status && (status === 'passed' || status === 'failed')) {
      conditions.push(eq(schema.testRuns.status, status));
    }
    if (days) {
      const cutoffMs = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
      conditions.push(gte(schema.testRuns.timestamp, cutoffMs));
    }

    const where = and(...conditions);

    const totalResult = await dbGet(db.select({ cnt: count() }).from(schema.testRuns).where(where));
    const total = totalResult?.cnt ?? 0;

    const rows = await dbAll(
      db.select().from(schema.testRuns).where(where)
        .orderBy(desc(schema.testRuns.timestamp))
        .limit(safeLimit).offset(safeOffset),
    );

    return {
      success: true,
      runs: rows.map(mapRunResponse),
      pagination: {
        total,
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + safeLimit < total,
      },
    };
  });

  // GET /api/runs/:id — Run detail
  app.get('/api/runs/:id', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { id } = request.params as { id: string };

    const run = await dbGet(db.select().from(schema.testRuns).where(
      and(eq(schema.testRuns.id, id), eq(schema.testRuns.teamId, teamId)),
    ));

    if (!run) {
      return reply.status(404).send({ success: false, error: 'Run not found', code: 'RUN_NOT_FOUND' });
    }

    const cases = await dbAll(
      db.select().from(schema.testCaseRuns).where(eq(schema.testCaseRuns.runId, id))
        .orderBy(asc(schema.testCaseRuns.createdAt)),
    );

    return {
      success: true,
      run: mapRunResponse(run),
      cases: cases.map((c: any) => ({
        id: c.id,
        runId: c.runId,
        suiteId: c.suiteId,
        caseName: c.caseName,
        status: c.status,
        duration: c.duration,
        attempts: c.attempts,
        responseMs: c.responseMs,
        assertions: c.assertions,
        error: c.error,
        snapshot: c.snapshot,
      })),
      flaky: [],
    };
  });
}

async function dbGet(query: any): Promise<any> {
  if (typeof query.get === 'function') return query.get();
  const rows = await query;
  return Array.isArray(rows) ? rows[0] : rows;
}

async function dbAll(query: any): Promise<any[]> {
  if (typeof query.all === 'function') return query.all();
  const rows = await query;
  return Array.isArray(rows) ? rows : [];
}

function mapRunResponse(row: any) {
  return {
    id: row.id,
    project: row.project,
    timestamp: row.timestamp,
    gitCommit: row.gitCommit,
    gitBranch: row.gitBranch,
    configHash: row.configHash,
    trigger: row.trigger,
    duration: row.duration,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    flaky: row.flaky,
    status: row.status,
    sourceDeveloper: row.sourceDeveloper,
    syncedAt: row.syncedAt,
  };
}
