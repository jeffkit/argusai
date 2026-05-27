import type { FastifyInstance } from 'fastify';
import { eq, and, desc, count } from 'drizzle-orm';

export async function projectRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;

  // GET /api/projects — List projects for authenticated team
  app.get('/api/projects', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const totalResult = db.select({ cnt: count() }).from(schema.projects)
      .where(eq(schema.projects.teamId, teamId)).get?.()
      ?? (await db.select({ cnt: count() }).from(schema.projects).where(eq(schema.projects.teamId, teamId)))?.[0];
    const total = totalResult?.cnt ?? 0;

    const rows = db.select().from(schema.projects)
      .where(eq(schema.projects.teamId, teamId))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(safeLimit)
      .offset(safeOffset)
      .all?.() ?? await db.select().from(schema.projects)
        .where(eq(schema.projects.teamId, teamId))
        .orderBy(desc(schema.projects.updatedAt))
        .limit(safeLimit)
        .offset(safeOffset);

    const projects = [];
    for (const row of rows) {
      // Get last run stats
      const lastRun = db.select().from(schema.testRuns)
        .where(eq(schema.testRuns.projectId, row.id))
        .orderBy(desc(schema.testRuns.timestamp))
        .limit(1)
        .get?.() ?? (await db.select().from(schema.testRuns)
          .where(eq(schema.testRuns.projectId, row.id))
          .orderBy(desc(schema.testRuns.timestamp))
          .limit(1))?.[0];

      const lastPassRate = lastRun
        ? ((lastRun.passed / Math.max(lastRun.passed + lastRun.failed, 1)) * 100)
        : null;

      projects.push({
        id: row.id,
        name: row.name,
        description: row.description,
        totalRuns: row.totalRuns,
        lastSyncAt: row.lastSyncAt,
        lastRunStatus: lastRun?.status ?? null,
        lastPassRate: lastPassRate !== null ? Math.round(lastPassRate * 10) / 10 : null,
        createdAt: row.createdAt,
      });
    }

    return {
      success: true,
      projects,
      pagination: {
        total,
        limit: safeLimit,
        offset: safeOffset,
        hasMore: safeOffset + safeLimit < total,
      },
    };
  });

  // GET /api/projects/:name — Detailed project info
  app.get('/api/projects/:name', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { name } = request.params as { name: string };

    const project = db.select().from(schema.projects)
      .where(and(eq(schema.projects.teamId, teamId), eq(schema.projects.name, name)))
      .get?.() ?? (await db.select().from(schema.projects)
        .where(and(eq(schema.projects.teamId, teamId), eq(schema.projects.name, name))))?.[0];

    if (!project) {
      return reply.status(404).send({
        success: false,
        error: `Project '${name}' not found`,
        code: 'PROJECT_NOT_FOUND',
      });
    }

    // Count distinct developers
    const devResult = db.selectDistinct({ dev: schema.testRuns.sourceDeveloper })
      .from(schema.testRuns)
      .where(eq(schema.testRuns.projectId, project.id))
      .all?.() ?? await db.selectDistinct({ dev: schema.testRuns.sourceDeveloper })
        .from(schema.testRuns).where(eq(schema.testRuns.projectId, project.id));
    const activeDevelopers = devResult.filter((r: any) => r.dev).length;

    // Count flaky tests (from last 10 runs)
    const recentRuns = db.select().from(schema.testRuns)
      .where(eq(schema.testRuns.projectId, project.id))
      .orderBy(desc(schema.testRuns.timestamp))
      .limit(10)
      .all?.() ?? await db.select().from(schema.testRuns)
        .where(eq(schema.testRuns.projectId, project.id))
        .orderBy(desc(schema.testRuns.timestamp))
        .limit(10);
    const totalFlakyTests = recentRuns.reduce((sum: number, r: any) => sum + (r.flaky || 0), 0);

    // Recent pass rate (average of last 10 runs)
    const recentPassRate = recentRuns.length > 0
      ? recentRuns.reduce((sum: number, r: any) => sum + (r.passed / Math.max(r.passed + r.failed, 1) * 100), 0) / recentRuns.length
      : null;

    return {
      success: true,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        totalRuns: project.totalRuns,
        lastSyncAt: project.lastSyncAt,
        recentPassRate: recentPassRate !== null ? Math.round(recentPassRate * 10) / 10 : null,
        totalFlakyTests,
        activeDevelopers,
        createdAt: project.createdAt,
      },
    };
  });
}
