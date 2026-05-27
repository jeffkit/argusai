import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { sqliteSchema, pgSchema } from 'argusai-core';
import type { ServerEnvConfig } from './config.js';
import { createServerDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createAuthHook } from './auth/auth-hook.js';
import { healthRoutes } from './routes/health.js';
import { teamRoutes } from './routes/teams.js';
import { syncRoutes } from './routes/sync.js';
import { projectRoutes } from './routes/projects.js';
import { runRoutes } from './routes/runs.js';
import { trendRoutes } from './routes/trends.js';
import { diagnosticRoutes } from './routes/diagnostics.js';
import { notificationRoutes } from './routes/notifications.js';

export async function createServerApp(config: ServerEnvConfig) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 10 * 1024 * 1024, // 10MB for sync payloads
  });

  await app.register(cors, { origin: true });

  // OpenAPI / Swagger documentation
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'ArgusAI Server API',
        description: 'Central service layer for team-wide E2E test result aggregation, sync, and notifications',
        version: '0.7.0',
      },
      servers: [{ url: `http://${config.HOST}:${config.PORT}` }],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
            description: 'Team API key obtained from POST /api/teams',
          },
        },
      },
      security: [{ apiKey: [] }],
      tags: [
        { name: 'Health', description: 'Server health and status' },
        { name: 'Teams', description: 'Team management and API key operations' },
        { name: 'Sync', description: 'Test result synchronization' },
        { name: 'Projects', description: 'Project listing and details' },
        { name: 'Runs', description: 'Test run queries and comparison' },
        { name: 'Trends', description: 'Trend analysis (pass rate, duration, flaky, failures)' },
        { name: 'Diagnostics', description: 'Failure patterns and fix history' },
        { name: 'Notifications', description: 'Enterprise WeChat notification configuration' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Database setup
  const db = await createServerDb(config);
  await runMigrations(db, config);

  // Pick schema based on dialect
  const schema = config.DATABASE_DIALECT === 'sqlite' ? sqliteSchema : pgSchema;

  // Decorate request for team context
  app.decorateRequest('teamId', undefined);
  app.decorateRequest('teamName', undefined);

  // Auth hook (skips public routes internally)
  const authHook = createAuthHook(db, schema);
  app.addHook('preHandler', authHook);

  // Register route plugins
  const routeOpts = { db, schema };

  await app.register(healthRoutes);
  await app.register(teamRoutes, routeOpts);
  await app.register(syncRoutes, routeOpts);
  await app.register(projectRoutes, routeOpts);
  await app.register(runRoutes, routeOpts);
  await app.register(trendRoutes, routeOpts);
  await app.register(diagnosticRoutes, routeOpts);
  await app.register(notificationRoutes, routeOpts);

  return app;
}
