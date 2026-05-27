import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const UpdateNotificationSchema = z.object({
  webhookUrl: z.string().url().nullable().optional(),
  onFailure: z.boolean().optional(),
  onSuccess: z.boolean().optional(),
  onNewFlaky: z.boolean().optional(),
  dailyDigest: z.boolean().optional(),
  digestTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  digestTimezone: z.string().optional(),
});

export async function notificationRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;

  // GET /api/teams/:id/notifications
  app.get('/api/teams/:id/notifications', async (request, reply) => {
    const { id } = request.params as { id: string };
    const teamId = (request as any).teamId;

    if (id !== teamId) {
      return reply.status(403).send({
        success: false,
        error: 'Cannot access notifications for another team',
        code: 'AUTH_FORBIDDEN',
      });
    }

    const config = await dbGet(
      db.select().from(schema.notificationConfigs).where(eq(schema.notificationConfigs.teamId, teamId)),
    );

    if (!config) {
      return {
        success: true,
        config: {
          webhookUrl: null,
          onFailure: true,
          onSuccess: false,
          onNewFlaky: false,
          dailyDigest: false,
          digestTime: '09:00',
          digestTimezone: 'Asia/Shanghai',
        },
      };
    }

    return {
      success: true,
      config: {
        webhookUrl: config.webhookUrl,
        onFailure: toBool(config.onFailure),
        onSuccess: toBool(config.onSuccess),
        onNewFlaky: toBool(config.onNewFlaky),
        dailyDigest: toBool(config.dailyDigest),
        digestTime: config.digestTime,
        digestTimezone: config.digestTimezone,
      },
    };
  });

  // PUT /api/teams/:id/notifications
  app.put('/api/teams/:id/notifications', async (request, reply) => {
    const { id } = request.params as { id: string };
    const teamId = (request as any).teamId;

    if (id !== teamId) {
      return reply.status(403).send({
        success: false,
        error: 'Cannot update notifications for another team',
        code: 'AUTH_FORBIDDEN',
      });
    }

    const body = UpdateNotificationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: `Validation failed: ${body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }

    const now = new Date().toISOString();
    const existing = await dbGet(
      db.select().from(schema.notificationConfigs).where(eq(schema.notificationConfigs.teamId, teamId)),
    );

    if (existing) {
      const updates: Record<string, any> = { updatedAt: now };
      if (body.data.webhookUrl !== undefined) updates.webhookUrl = body.data.webhookUrl;
      if (body.data.onFailure !== undefined) updates.onFailure = body.data.onFailure ? 1 : 0;
      if (body.data.onSuccess !== undefined) updates.onSuccess = body.data.onSuccess ? 1 : 0;
      if (body.data.onNewFlaky !== undefined) updates.onNewFlaky = body.data.onNewFlaky ? 1 : 0;
      if (body.data.dailyDigest !== undefined) updates.dailyDigest = body.data.dailyDigest ? 1 : 0;
      if (body.data.digestTime !== undefined) updates.digestTime = body.data.digestTime;
      if (body.data.digestTimezone !== undefined) updates.digestTimezone = body.data.digestTimezone;

      await dbRun(
        db.update(schema.notificationConfigs)
          .set(updates)
          .where(eq(schema.notificationConfigs.teamId, teamId)),
      );
    } else {
      await dbRun(db.insert(schema.notificationConfigs).values({
        id: randomUUID(),
        teamId,
        webhookUrl: body.data.webhookUrl ?? null,
        onFailure: (body.data.onFailure ?? true) ? 1 : 0,
        onSuccess: (body.data.onSuccess ?? false) ? 1 : 0,
        onNewFlaky: (body.data.onNewFlaky ?? false) ? 1 : 0,
        dailyDigest: (body.data.dailyDigest ?? false) ? 1 : 0,
        digestTime: body.data.digestTime ?? '09:00',
        digestTimezone: body.data.digestTimezone ?? 'Asia/Shanghai',
        createdAt: now,
        updatedAt: now,
      }));
    }

    const updated = await dbGet(
      db.select().from(schema.notificationConfigs).where(eq(schema.notificationConfigs.teamId, teamId)),
    );

    return {
      success: true,
      config: {
        webhookUrl: updated.webhookUrl,
        onFailure: toBool(updated.onFailure),
        onSuccess: toBool(updated.onSuccess),
        onNewFlaky: toBool(updated.onNewFlaky),
        dailyDigest: toBool(updated.dailyDigest),
        digestTime: updated.digestTime,
        digestTimezone: updated.digestTimezone,
      },
    };
  });
}

async function dbGet(query: any): Promise<any> {
  if (typeof query.get === 'function') return query.get();
  const rows = await query;
  return Array.isArray(rows) ? rows[0] : rows;
}

async function dbRun(query: any): Promise<void> {
  if (typeof query.run === 'function') { query.run(); return; }
  await query;
}

function toBool(val: any): boolean {
  return val === 1 || val === true;
}
