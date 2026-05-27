import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { hashApiKey } from './api-key.js';

const PUBLIC_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/health' },
  { method: 'POST', path: '/api/teams' },
];

function isPublicRoute(method: string, url: string): boolean {
  const cleanUrl = url.split('?')[0]!;
  return PUBLIC_ROUTES.some(
    (r) => r.method === method && cleanUrl === r.path,
  );
}

/**
 * Create a Fastify preHandler hook that validates X-API-Key headers.
 * On success, injects `request.teamId` and `request.teamName`.
 */
export function createAuthHook(db: any, schema: any) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply) {
    if (isPublicRoute(request.method, request.url)) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid or missing API key',
        code: 'AUTH_INVALID_KEY',
      });
    }

    const keyHash = hashApiKey(apiKey);

    const team = db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.apiKeyHash, keyHash))
      .get?.() ?? (await db.select().from(schema.teams).where(eq(schema.teams.apiKeyHash, keyHash)))?.[0];

    if (!team) {
      return reply.status(401).send({
        success: false,
        error: 'Invalid or missing API key',
        code: 'AUTH_INVALID_KEY',
      });
    }

    (request as any).teamId = team.id;
    (request as any).teamName = team.name;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    teamId?: string;
    teamName?: string;
  }
}
