import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export interface SyncRunResult {
  runStatus: 'created' | 'already_exists';
  projectStatus: 'created' | 'existing';
  casesStored: number;
  patternsStored: number;
  patternsDeduped: number;
}

export interface SyncPatternResult {
  patternsCreated: number;
  patternsUpdated: number;
  fixesStored: number;
}

/**
 * Processes incoming sync data from local ArgusAI instances.
 * Handles auto-project registration, idempotent run storage, and pattern dedup.
 */
export class SyncService {
  constructor(private db: any, private schema: any) {}

  async processRunSync(teamId: string, teamName: string, payload: any): Promise<SyncRunResult> {
    if (payload.team !== teamName) {
      throw Object.assign(
        new Error(`Team name '${payload.team}' does not match API key team '${teamName}'`),
        { statusCode: 403, code: 'AUTH_TEAM_MISMATCH' },
      );
    }

    // Find or create project (auto-registration)
    let projectStatus: 'created' | 'existing' = 'existing';
    let project = await this.dbGet(
      this.db.select().from(this.schema.projects).where(
        and(eq(this.schema.projects.teamId, teamId), eq(this.schema.projects.name, payload.project)),
      ),
    );

    if (!project) {
      const projectId = randomUUID();
      const now = new Date().toISOString();
      await this.dbRun(this.db.insert(this.schema.projects).values({
        id: projectId,
        teamId,
        name: payload.project,
        description: null,
        lastSyncAt: now,
        totalRuns: 0,
        createdAt: now,
        updatedAt: now,
      }));
      project = { id: projectId, name: payload.project };
      projectStatus = 'created';
    }

    // Idempotent run insert
    const existingRun = await this.dbGet(
      this.db.select().from(this.schema.testRuns).where(eq(this.schema.testRuns.id, payload.run.id)),
    );

    if (existingRun) {
      return {
        runStatus: 'already_exists',
        projectStatus,
        casesStored: 0,
        patternsStored: 0,
        patternsDeduped: 0,
      };
    }

    const now = new Date().toISOString();

    // Insert run
    await this.dbRun(this.db.insert(this.schema.testRuns).values({
      id: payload.run.id,
      project: payload.project,
      teamId,
      projectId: project.id,
      timestamp: payload.run.timestamp,
      gitCommit: payload.run.gitCommit,
      gitBranch: payload.run.gitBranch,
      configHash: payload.run.configHash,
      trigger: payload.run.trigger,
      duration: payload.run.duration,
      passed: payload.run.passed,
      failed: payload.run.failed,
      skipped: payload.run.skipped,
      flaky: payload.run.flaky,
      status: payload.run.status,
      sourceDeveloper: payload.sourceDeveloper ?? null,
      syncedAt: now,
      createdAt: now,
    }));

    // Insert cases
    let casesStored = 0;
    if (payload.cases && Array.isArray(payload.cases)) {
      for (const c of payload.cases) {
        await this.dbRun(this.db.insert(this.schema.testCaseRuns).values({
          id: c.id,
          runId: payload.run.id,
          suiteId: c.suiteId,
          caseName: c.caseName,
          status: c.status,
          duration: c.duration,
          attempts: c.attempts,
          responseMs: c.responseMs,
          assertions: c.assertions,
          error: c.error ? c.error.slice(0, 2000) : null,
          snapshot: c.snapshot,
          createdAt: now,
        }));
        casesStored++;
      }
    }

    // Update project stats
    await this.dbRun(
      this.db.update(this.schema.projects)
        .set({
          totalRuns: sql`${this.schema.projects.totalRuns} + 1`,
          lastSyncAt: now,
          updatedAt: now,
        })
        .where(eq(this.schema.projects.id, project.id)),
    );

    // Process patterns if included
    let patternsStored = 0;
    let patternsDeduped = 0;
    if (payload.patterns && Array.isArray(payload.patterns)) {
      const result = await this.processPatterns(teamId, project.id, payload.patterns);
      patternsStored = result.created;
      patternsDeduped = result.deduped;
    }

    return {
      runStatus: 'created',
      projectStatus,
      casesStored,
      patternsStored,
      patternsDeduped,
    };
  }

  async processPatternSync(teamId: string, teamName: string, payload: any): Promise<SyncPatternResult> {
    if (payload.team !== teamName) {
      throw Object.assign(
        new Error(`Team name '${payload.team}' does not match API key team '${teamName}'`),
        { statusCode: 403, code: 'AUTH_TEAM_MISMATCH' },
      );
    }

    // Find project
    const project = await this.dbGet(
      this.db.select().from(this.schema.projects).where(
        and(eq(this.schema.projects.teamId, teamId), eq(this.schema.projects.name, payload.project)),
      ),
    );
    const projectId = project?.id ?? null;

    let patternsCreated = 0;
    let patternsUpdated = 0;

    if (payload.patterns && Array.isArray(payload.patterns)) {
      for (const p of payload.patterns) {
        const existing = await this.dbGet(
          this.db.select().from(this.schema.failurePatterns).where(
            and(eq(this.schema.failurePatterns.teamId, teamId), eq(this.schema.failurePatterns.signature, p.signature)),
          ),
        );

        const now = new Date().toISOString();

        if (existing) {
          await this.dbRun(
            this.db.update(this.schema.failurePatterns)
              .set({
                occurrences: (p.occurrences ?? 0) + existing.occurrences,
                resolutions: (p.resolutions ?? 0) + existing.resolutions,
                lastSeenAt: p.lastSeenAt ?? now,
                updatedAt: now,
                confidence: Math.max(existing.confidence, p.confidence ?? 0.5),
              })
              .where(eq(this.schema.failurePatterns.id, existing.id)),
          );
          patternsUpdated++;
        } else {
          await this.dbRun(this.db.insert(this.schema.failurePatterns).values({
            id: randomUUID(),
            category: p.category,
            signature: p.signature,
            signaturePattern: p.signaturePattern,
            description: p.description ?? '',
            suggestedFix: p.suggestedFix ?? '',
            confidence: p.confidence ?? 0.5,
            occurrences: p.occurrences ?? 1,
            resolutions: p.resolutions ?? 0,
            source: p.source ?? 'learned',
            firstSeenAt: p.firstSeenAt ?? now,
            lastSeenAt: p.lastSeenAt ?? now,
            createdAt: now,
            updatedAt: now,
            teamId,
            projectId,
          }));
          patternsCreated++;
        }
      }
    }

    // Process fixes
    let fixesStored = 0;
    if (payload.fixes && Array.isArray(payload.fixes)) {
      for (const f of payload.fixes) {
        const pattern = await this.dbGet(
          this.db.select().from(this.schema.failurePatterns).where(
            and(
              eq(this.schema.failurePatterns.teamId, teamId),
              eq(this.schema.failurePatterns.signature, f.patternSignature),
            ),
          ),
        );
        if (pattern) {
          await this.dbRun(this.db.insert(this.schema.fixHistory).values({
            id: randomUUID(),
            patternId: pattern.id,
            runId: f.runId,
            caseName: f.caseName,
            fixDescription: f.fixDescription,
            success: f.success ? 1 : 0,
            createdAt: f.createdAt ?? new Date().toISOString(),
          }));
          fixesStored++;
        }
      }
    }

    return { patternsCreated, patternsUpdated, fixesStored };
  }

  private async processPatterns(teamId: string, projectId: string, patterns: any[]): Promise<{ created: number; deduped: number }> {
    let created = 0;
    let deduped = 0;

    for (const p of patterns) {
      const existing = await this.dbGet(
        this.db.select().from(this.schema.failurePatterns).where(
          and(eq(this.schema.failurePatterns.teamId, teamId), eq(this.schema.failurePatterns.signature, p.signature)),
        ),
      );

      const now = new Date().toISOString();

      if (existing) {
        await this.dbRun(
          this.db.update(this.schema.failurePatterns)
            .set({
              occurrences: existing.occurrences + 1,
              lastSeenAt: now,
              updatedAt: now,
            })
            .where(eq(this.schema.failurePatterns.id, existing.id)),
        );
        deduped++;
      } else {
        await this.dbRun(this.db.insert(this.schema.failurePatterns).values({
          id: randomUUID(),
          category: p.category,
          signature: p.signature,
          signaturePattern: p.signaturePattern,
          description: p.description ?? '',
          suggestedFix: p.suggestedFix ?? '',
          confidence: p.confidence ?? 0.5,
          occurrences: 1,
          resolutions: 0,
          source: p.source ?? 'learned',
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
          teamId,
          projectId,
        }));
        created++;
      }
    }

    return { created, deduped };
  }

  private async dbGet(query: any): Promise<any> {
    if (typeof query.get === 'function') return query.get();
    const rows = await query;
    return Array.isArray(rows) ? rows[0] : rows;
  }

  private async dbRun(query: any): Promise<void> {
    if (typeof query.run === 'function') { query.run(); return; }
    await query;
  }
}
