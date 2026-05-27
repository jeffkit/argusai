import type { FastifyInstance } from 'fastify';
import { eq, and, desc, count } from 'drizzle-orm';

export async function diagnosticRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;

  // GET /api/patterns — List failure patterns
  app.get('/api/patterns', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { project, category, source, limit = 50 } = request.query as {
      project?: string; category?: string; source?: string; limit?: number;
    };

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const conditions = [eq(schema.failurePatterns.teamId, teamId)];

    if (project) {
      const proj = await dbGet(
        db.select().from(schema.projects).where(
          and(eq(schema.projects.teamId, teamId), eq(schema.projects.name, project)),
        ),
      );
      if (proj) {
        conditions.push(eq(schema.failurePatterns.projectId, proj.id));
      }
    }

    if (category) {
      conditions.push(eq(schema.failurePatterns.category, category));
    }

    if (source && (source === 'built-in' || source === 'learned')) {
      conditions.push(eq(schema.failurePatterns.source, source));
    }

    const where = and(...conditions);

    const totalResult = await dbGet(db.select({ cnt: count() }).from(schema.failurePatterns).where(where));
    const total = totalResult?.cnt ?? 0;

    const rows = await dbAll(
      db.select().from(schema.failurePatterns).where(where)
        .orderBy(desc(schema.failurePatterns.occurrences))
        .limit(safeLimit),
    );

    return {
      success: true,
      patterns: rows.map((r: any) => ({
        id: r.id,
        category: r.category,
        signature: r.signature,
        signaturePattern: r.signaturePattern,
        description: r.description,
        suggestedFix: r.suggestedFix,
        confidence: r.confidence,
        occurrences: r.occurrences,
        resolutions: r.resolutions,
        source: r.source,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
      })),
      total,
    };
  });

  // GET /api/patterns/:id/fixes — Fix history for a pattern
  app.get('/api/patterns/:id/fixes', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { id } = request.params as { id: string };
    const { limit = 10 } = request.query as { limit?: number };

    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);

    // Verify pattern belongs to auth team
    const pattern = await dbGet(
      db.select().from(schema.failurePatterns).where(
        and(eq(schema.failurePatterns.id, id), eq(schema.failurePatterns.teamId, teamId)),
      ),
    );

    if (!pattern) {
      return reply.status(404).send({
        success: false,
        error: 'Pattern not found',
        code: 'PATTERN_NOT_FOUND',
      });
    }

    const fixes = await dbAll(
      db.select().from(schema.fixHistory).where(eq(schema.fixHistory.patternId, id))
        .orderBy(desc(schema.fixHistory.createdAt))
        .limit(safeLimit),
    );

    return {
      success: true,
      fixes: fixes.map((f: any) => ({
        id: f.id,
        patternId: f.patternId,
        runId: f.runId,
        caseName: f.caseName,
        fixDescription: f.fixDescription,
        success: f.success === 1 || f.success === true,
        createdAt: f.createdAt,
      })),
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
