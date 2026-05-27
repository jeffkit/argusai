import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SyncService } from '../services/sync-service.js';
import { NotificationTrigger } from '../notifications/trigger.js';
import type { NotificationConfig, CaseSummary, RunSummary } from '../notifications/types.js';

const SyncRunsBodySchema = z.object({
  project: z.string().min(1),
  team: z.string().min(1),
  sourceDeveloper: z.string().optional(),
  run: z.object({
    id: z.string().min(1),
    timestamp: z.number(),
    gitCommit: z.string().nullable(),
    gitBranch: z.string().nullable(),
    configHash: z.string(),
    trigger: z.enum(['cli', 'mcp', 'dashboard', 'ci']),
    duration: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    flaky: z.number(),
    status: z.enum(['passed', 'failed']),
  }),
  cases: z.array(z.object({
    id: z.string().min(1),
    suiteId: z.string(),
    caseName: z.string(),
    status: z.enum(['passed', 'failed', 'skipped']),
    duration: z.number(),
    attempts: z.number(),
    responseMs: z.number().nullable(),
    assertions: z.number().nullable(),
    error: z.string().nullable(),
    snapshot: z.string().nullable(),
  })),
  patterns: z.array(z.object({
    category: z.string(),
    signature: z.string(),
    signaturePattern: z.string(),
    description: z.string(),
    suggestedFix: z.string(),
    confidence: z.number(),
    source: z.enum(['built-in', 'learned']),
  })).optional(),
});

const SyncPatternsBodySchema = z.object({
  project: z.string().min(1),
  team: z.string().min(1),
  patterns: z.array(z.object({
    category: z.string(),
    signature: z.string(),
    signaturePattern: z.string(),
    description: z.string(),
    suggestedFix: z.string(),
    confidence: z.number(),
    occurrences: z.number(),
    resolutions: z.number(),
    source: z.enum(['built-in', 'learned']),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
  })),
  fixes: z.array(z.object({
    patternSignature: z.string(),
    runId: z.string(),
    caseName: z.string(),
    fixDescription: z.string(),
    success: z.boolean(),
    createdAt: z.string(),
  })).optional(),
});

export async function syncRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;
  const syncService = new SyncService(db, schema);
  const notificationTrigger = new NotificationTrigger(db, schema);

  // POST /api/sync/runs
  app.post('/api/sync/runs', async (request, reply) => {
    const body = SyncRunsBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: `Validation failed: ${body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }

    const teamId = (request as any).teamId;
    const teamName = (request as any).teamName;

    try {
      const result = await syncService.processRunSync(teamId, teamName, body.data);

      // Fire-and-forget notification evaluation
      let notificationsTriggered: string[] = [];
      if (result.runStatus === 'created') {
        triggerNotifications(
          db, schema, notificationTrigger, teamId, teamName, body.data, request.log,
        ).then((triggered) => {
          notificationsTriggered = triggered;
        }).catch((err) => {
          request.log.warn(err, 'Notification trigger failed');
        });
      }

      return {
        success: true,
        result: {
          ...result,
          notificationsTriggered,
        },
      };
    } catch (err: any) {
      if (err.statusCode === 403) {
        return reply.status(403).send({ success: false, error: err.message, code: err.code });
      }
      request.log.error(err, 'Sync processing error');
      return reply.status(503).send({
        success: false,
        error: 'Database temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE',
      });
    }
  });

  // POST /api/sync/patterns
  app.post('/api/sync/patterns', async (request, reply) => {
    const body = SyncPatternsBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: `Validation failed: ${body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }

    const teamId = (request as any).teamId;
    const teamName = (request as any).teamName;

    try {
      const result = await syncService.processPatternSync(teamId, teamName, body.data);
      return { success: true, result };
    } catch (err: any) {
      if (err.statusCode === 403) {
        return reply.status(403).send({ success: false, error: err.message, code: err.code });
      }
      request.log.error(err, 'Pattern sync processing error');
      return reply.status(503).send({
        success: false,
        error: 'Database temporarily unavailable',
        code: 'SERVICE_UNAVAILABLE',
      });
    }
  });
}

async function triggerNotifications(
  db: any,
  schema: any,
  trigger: NotificationTrigger,
  teamId: string,
  teamName: string,
  payload: any,
  log: any,
): Promise<string[]> {
  try {
    const config = db.select().from(schema.notificationConfigs)
      .where(eq(schema.notificationConfigs.teamId, teamId))
      .get?.() ?? (await db.select().from(schema.notificationConfigs)
        .where(eq(schema.notificationConfigs.teamId, teamId)))?.[0];

    if (!config || !config.webhookUrl) return [];

    const notifConfig: NotificationConfig = {
      id: config.id,
      teamId: config.teamId,
      webhookUrl: config.webhookUrl,
      onFailure: config.onFailure === 1 || config.onFailure === true,
      onSuccess: config.onSuccess === 1 || config.onSuccess === true,
      onNewFlaky: config.onNewFlaky === 1 || config.onNewFlaky === true,
      dailyDigest: config.dailyDigest === 1 || config.dailyDigest === true,
      digestTime: config.digestTime ?? '09:00',
      digestTimezone: config.digestTimezone ?? 'Asia/Shanghai',
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };

    const runSummary: RunSummary = {
      id: payload.run.id,
      project: payload.project,
      timestamp: payload.run.timestamp,
      passed: payload.run.passed,
      failed: payload.run.failed,
      skipped: payload.run.skipped,
      flaky: payload.run.flaky,
      status: payload.run.status,
      duration: payload.run.duration,
      sourceDeveloper: payload.sourceDeveloper,
    };

    const caseSummaries: CaseSummary[] = (payload.cases ?? []).map((c: any) => ({
      caseName: c.caseName,
      suiteId: c.suiteId,
      status: c.status,
      error: c.error,
      duration: c.duration,
    }));

    return await trigger.evaluateAndSend(teamId, teamName, runSummary, caseSummaries, notifConfig);
  } catch (err) {
    log.warn(err, 'Notification trigger error');
    return [];
  }
}
