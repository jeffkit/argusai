import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServerApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('End-to-end sync flow', () => {
  let app: FastifyInstance;
  let teamId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await createServerApp({
      DATABASE_URL: ':memory:',
      DATABASE_DIALECT: 'sqlite',
      PORT: 0,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. health check works without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('argusai-server');
  });

  it('2. create a team via API', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/teams',
      payload: { name: 'e2e-test-team' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.apiKey).toBeTruthy();
    expect(body.apiKey.length).toBe(64);

    teamId = body.team.id;
    apiKey = body.apiKey;
  });

  it('3. GET /api/teams requires auth', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(noAuth.statusCode).toBe(401);

    const withAuth = await app.inject({
      method: 'GET',
      url: '/api/teams',
      headers: { 'x-api-key': apiKey },
    });
    expect(withAuth.statusCode).toBe(200);
    expect(withAuth.json().team.name).toBe('e2e-test-team');
  });

  it('4. sync a test run', async () => {
    const run = {
      project: 'e2e-project',
      team: 'e2e-test-team',
      sourceDeveloper: 'test-machine',
      run: {
        id: 'run-e2e-001',
        timestamp: Date.now(),
        gitCommit: 'abc123',
        gitBranch: 'main',
        configHash: 'hash123',
        trigger: 'cli',
        duration: 45000,
        passed: 18,
        failed: 2,
        skipped: 1,
        flaky: 1,
        status: 'failed',
      },
      cases: [
        {
          id: 'case-001',
          suiteId: 'api-tests',
          caseName: 'health-check',
          status: 'passed',
          duration: 1200,
          attempts: 1,
          responseMs: 45,
          assertions: 3,
          error: null,
          snapshot: null,
        },
        {
          id: 'case-002',
          suiteId: 'api-tests',
          caseName: 'payment-flow',
          status: 'failed',
          duration: 5000,
          attempts: 1,
          responseMs: null,
          assertions: null,
          error: 'Expected 200, got 500',
          snapshot: null,
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/runs',
      headers: { 'x-api-key': apiKey },
      payload: run,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.result.runStatus).toBe('created');
    expect(body.result.projectStatus).toBe('created');
    expect(body.result.casesStored).toBe(2);
  });

  it('5. verify project auto-registered', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe('e2e-project');
    expect(body.projects[0].totalRuns).toBe(1);
  });

  it('6. verify run appears in list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs?project=e2e-project',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe('run-e2e-001');
    expect(body.runs[0].failed).toBe(2);
    expect(body.runs[0].sourceDeveloper).toBe('test-machine');
  });

  it('7. verify run detail with cases', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs/run-e2e-001',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe('run-e2e-001');
    expect(body.cases).toHaveLength(2);
  });

  it('8. verify trends compute', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/trends/pass-rate?project=e2e-project&days=30',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.dataPoints.length).toBeGreaterThanOrEqual(1);
  });

  it('9. idempotent re-sync (no duplicates)', async () => {
    const run = {
      project: 'e2e-project',
      team: 'e2e-test-team',
      sourceDeveloper: 'test-machine',
      run: {
        id: 'run-e2e-001',
        timestamp: Date.now(),
        gitCommit: 'abc123',
        gitBranch: 'main',
        configHash: 'hash123',
        trigger: 'cli',
        duration: 45000,
        passed: 18,
        failed: 2,
        skipped: 1,
        flaky: 1,
        status: 'failed',
      },
      cases: [],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/runs',
      headers: { 'x-api-key': apiKey },
      payload: run,
    });
    expect(res.json().result.runStatus).toBe('already_exists');

    // Verify still only 1 run
    const runsRes = await app.inject({
      method: 'GET',
      url: '/api/runs?project=e2e-project',
      headers: { 'x-api-key': apiKey },
    });
    expect(runsRes.json().runs).toHaveLength(1);
  });

  it('10. notification config CRUD', async () => {
    // Get default config
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/teams/${teamId}/notifications`,
      headers: { 'x-api-key': apiKey },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().config.onFailure).toBe(true);

    // Update config
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/teams/${teamId}/notifications`,
      headers: { 'x-api-key': apiKey },
      payload: {
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
        onSuccess: true,
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().config.webhookUrl).toContain('qyapi.weixin.qq.com');
    expect(putRes.json().config.onSuccess).toBe(true);
  });

  it('11. duplicate team name returns 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/teams',
      payload: { name: 'e2e-test-team' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('TEAM_EXISTS');
  });
});
