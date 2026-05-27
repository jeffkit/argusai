import type { FastifyInstance } from 'fastify';
import { eq, count, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateApiKey, hashApiKey } from '../auth/api-key.js';

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
});

export async function teamRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;

  // POST /api/teams — Create a new team (no auth required)
  app.post('/api/teams', async (request, reply) => {
    const body = CreateTeamSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: `Validation failed: ${body.error.issues.map((i) => i.message).join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }

    const { name } = body.data;

    // Check for duplicate name
    const existing = db.select().from(schema.teams).where(eq(schema.teams.name, name)).get?.()
      ?? (await db.select().from(schema.teams).where(eq(schema.teams.name, name)))?.[0];

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: `Team name '${name}' already exists`,
        code: 'TEAM_EXISTS',
      });
    }

    const { rawKey, hash, prefix } = generateApiKey();
    const now = new Date().toISOString();
    const id = randomUUID();

    if (db.insert(schema.teams).values) {
      db.insert(schema.teams).values({
        id,
        name,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        createdAt: now,
        updatedAt: now,
      }).run?.() ?? await db.insert(schema.teams).values({
        id,
        name,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        createdAt: now,
        updatedAt: now,
      });
    }

    return reply.status(201).send({
      success: true,
      team: {
        id,
        name,
        createdAt: now,
      },
      apiKey: rawKey,
      warning: 'Save this API key now — it will not be shown again.',
    });
  });

  // GET /api/teams — Get authenticated team info
  app.get('/api/teams', async (request, reply) => {
    const teamId = (request as any).teamId;
    const teamName = (request as any).teamName;

    if (!teamId) {
      return reply.status(401).send({ success: false, error: 'Unauthorized', code: 'AUTH_INVALID_KEY' });
    }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get?.()
      ?? (await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)))?.[0];

    if (!team) {
      return reply.status(404).send({ success: false, error: 'Team not found', code: 'TEAM_NOT_FOUND' });
    }

    const projectCount = db.select({ cnt: count() }).from(schema.projects)
      .where(eq(schema.projects.teamId, teamId)).get?.()?.cnt
      ?? (await db.select({ cnt: count() }).from(schema.projects).where(eq(schema.projects.teamId, teamId)))?.[0]?.cnt ?? 0;

    const totalRunsResult = db.select({ cnt: count() }).from(schema.testRuns)
      .where(eq(schema.testRuns.teamId, teamId)).get?.()?.cnt
      ?? (await db.select({ cnt: count() }).from(schema.testRuns).where(eq(schema.testRuns.teamId, teamId)))?.[0]?.cnt ?? 0;

    return {
      success: true,
      team: {
        id: team.id,
        name: team.name,
        apiKeyPrefix: team.apiKeyPrefix,
        projectCount,
        totalRuns: totalRunsResult,
        createdAt: team.createdAt,
      },
    };
  });

  // DELETE /api/teams/:id — Delete own team
  app.delete('/api/teams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const teamId = (request as any).teamId;

    if (id !== teamId) {
      return reply.status(403).send({
        success: false,
        error: 'Cannot delete a team other than your own',
        code: 'AUTH_FORBIDDEN',
      });
    }

    const team = db.select().from(schema.teams).where(eq(schema.teams.id, id)).get?.()
      ?? (await db.select().from(schema.teams).where(eq(schema.teams.id, id)))?.[0];

    if (!team) {
      return reply.status(404).send({ success: false, error: 'Team not found', code: 'TEAM_NOT_FOUND' });
    }

    db.delete(schema.teams).where(eq(schema.teams.id, id)).run?.()
      ?? await db.delete(schema.teams).where(eq(schema.teams.id, id));

    return {
      success: true,
      message: `Team '${team.name}' and all associated data deleted`,
    };
  });

  // POST /api/teams/:id/reset-key — Reset API key
  app.post('/api/teams/:id/reset-key', async (request, reply) => {
    const { id } = request.params as { id: string };
    const teamId = (request as any).teamId;

    if (id !== teamId) {
      return reply.status(403).send({
        success: false,
        error: 'Cannot reset key for a team other than your own',
        code: 'AUTH_FORBIDDEN',
      });
    }

    const { rawKey, hash, prefix } = generateApiKey();
    const now = new Date().toISOString();

    db.update(schema.teams)
      .set({ apiKeyHash: hash, apiKeyPrefix: prefix, updatedAt: now })
      .where(eq(schema.teams.id, id))
      .run?.() ?? await db.update(schema.teams)
        .set({ apiKeyHash: hash, apiKeyPrefix: prefix, updatedAt: now })
        .where(eq(schema.teams.id, id));

    return {
      success: true,
      apiKey: rawKey,
      warning: 'Save this API key now — it will not be shown again. The old key is now invalid.',
    };
  });
}
