import type { FastifyInstance } from 'fastify';

const startTime = Date.now();

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    return {
      status: 'ok',
      service: 'argusai-server',
      version: '0.7.0',
      uptime: uptimeSeconds,
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  });
}
