import type { FastifyInstance } from 'fastify';
import { TrendService } from '../services/trend-service.js';

export async function trendRoutes(app: FastifyInstance, opts: { db: any; schema: any }) {
  const { db, schema } = opts;
  const trendService = new TrendService(db, schema);

  // GET /api/trends/pass-rate
  app.get('/api/trends/pass-rate', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { project, days = 30 } = request.query as { project?: string; days?: number };

    if (!project) {
      return reply.status(400).send({
        success: false,
        error: 'project query parameter is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const safeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const dataPoints = await trendService.getPassRateTrend(teamId, project, safeDays);

    const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];

    return {
      success: true,
      period: { from, to },
      granularity: 'daily',
      dataPoints,
    };
  });

  // GET /api/trends/duration
  app.get('/api/trends/duration', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { project, days = 30 } = request.query as { project?: string; days?: number };

    if (!project) {
      return reply.status(400).send({
        success: false,
        error: 'project query parameter is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const safeDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const dataPoints = await trendService.getDurationTrend(teamId, project, safeDays);

    const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];

    return {
      success: true,
      period: { from, to },
      dataPoints,
    };
  });

  // GET /api/trends/flaky
  app.get('/api/trends/flaky', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { project, topN = 10 } = request.query as { project?: string; topN?: number };

    if (!project) {
      return reply.status(400).send({
        success: false,
        error: 'project query parameter is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const safeTopN = Math.min(Math.max(Number(topN) || 10, 1), 50);
    const cases = await trendService.getFlakyRanking(teamId, project, safeTopN);

    return {
      success: true,
      cases,
      totalFlaky: cases.length,
      analysisWindow: 10,
    };
  });

  // GET /api/trends/failures
  app.get('/api/trends/failures', async (request, reply) => {
    const teamId = (request as any).teamId;
    const { project, caseName, days = 7 } = request.query as {
      project?: string; caseName?: string; days?: number;
    };

    if (!project || !caseName) {
      return reply.status(400).send({
        success: false,
        error: 'project and caseName query parameters are required',
        code: 'VALIDATION_ERROR',
      });
    }

    const safeDays = Math.min(Math.max(Number(days) || 7, 1), 365);
    const dataPoints = await trendService.getFailureTrend(teamId, project, caseName, safeDays);

    const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];

    const totalRuns = dataPoints.filter((d) => d.status !== 'no-run').length;
    const failures = dataPoints.filter((d) => d.status === 'failed').length;

    return {
      success: true,
      caseName,
      period: { from, to },
      dataPoints,
      summary: {
        totalRuns,
        failures,
        flakyScore: totalRuns > 0 ? Math.round((failures / totalRuns) * 100) / 100 : 0,
        level: failures === 0 ? 'STABLE' : failures / Math.max(totalRuns, 1) >= 0.5 ? 'VERY_FLAKY' : 'FLAKY',
      },
    };
  });
}
