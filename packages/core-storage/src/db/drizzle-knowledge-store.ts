import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { KnowledgeStore, FailurePattern, FailureCategory, FixRecord } from '../knowledge/types.js';
import type { SqliteDb } from './create-db.js';
import { failurePatterns, fixHistory } from './schema-sqlite.js';

/**
 * KnowledgeStore implementation backed by Drizzle ORM.
 * Drop-in replacement for SQLiteKnowledgeStore.
 */
export class DrizzleKnowledgeStore implements KnowledgeStore {
  constructor(private db: SqliteDb) {}

  findBySignature(signature: string): FailurePattern | null {
    const row = this.db
      .select()
      .from(failurePatterns)
      .where(eq(failurePatterns.signature, signature))
      .get();

    return row ? mapPatternRow(row) : null;
  }

  findByCategory(category: FailureCategory): FailurePattern[] {
    const rows = this.db
      .select()
      .from(failurePatterns)
      .where(eq(failurePatterns.category, category))
      .all();

    return rows.map(mapPatternRow);
  }

  findBySource(source: 'built-in' | 'learned'): FailurePattern[] {
    const rows = this.db
      .select()
      .from(failurePatterns)
      .where(eq(failurePatterns.source, source))
      .all();

    return rows.map(mapPatternRow);
  }

  getAllPatterns(): FailurePattern[] {
    const rows = this.db
      .select()
      .from(failurePatterns)
      .orderBy(desc(failurePatterns.occurrences))
      .all();

    return rows.map(mapPatternRow);
  }

  createPattern(
    pattern: Omit<FailurePattern, 'id' | 'createdAt' | 'updatedAt'>,
  ): FailurePattern {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.transaction((tx) => {
      tx.insert(failurePatterns).values({
        id,
        category: pattern.category,
        signature: pattern.signature,
        signaturePattern: pattern.signaturePattern,
        description: pattern.description,
        suggestedFix: pattern.suggestedFix,
        confidence: pattern.confidence,
        occurrences: pattern.occurrences,
        resolutions: pattern.resolutions,
        source: pattern.source,
        firstSeenAt: pattern.firstSeenAt,
        lastSeenAt: pattern.lastSeenAt,
        createdAt: now,
        updatedAt: now,
      }).run();
    });

    return {
      ...pattern,
      id,
      createdAt: now,
      updatedAt: now,
    };
  }

  incrementOccurrences(patternId: string): void {
    const now = new Date().toISOString();

    this.db.transaction((tx) => {
      const current = tx
        .select({ occurrences: failurePatterns.occurrences })
        .from(failurePatterns)
        .where(eq(failurePatterns.id, patternId))
        .get();

      if (current) {
        tx.update(failurePatterns)
          .set({
            occurrences: current.occurrences + 1,
            lastSeenAt: now,
            updatedAt: now,
          })
          .where(eq(failurePatterns.id, patternId))
          .run();
      }
    });
  }

  recordFix(fix: Omit<FixRecord, 'id' | 'createdAt'>): FixRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.transaction((tx) => {
      tx.insert(fixHistory).values({
        id,
        patternId: fix.patternId,
        runId: fix.runId,
        caseName: fix.caseName,
        fixDescription: fix.fixDescription,
        success: fix.success ? 1 : 0,
        createdAt: now,
      }).run();
    });

    return {
      id,
      patternId: fix.patternId,
      runId: fix.runId,
      caseName: fix.caseName,
      fixDescription: fix.fixDescription,
      success: fix.success,
      createdAt: now,
    };
  }

  getFixHistory(patternId: string, limit = 10): FixRecord[] {
    const rows = this.db
      .select()
      .from(fixHistory)
      .where(eq(fixHistory.patternId, patternId))
      .orderBy(desc(fixHistory.createdAt))
      .limit(limit)
      .all();

    return rows.map(mapFixRow);
  }

  updateConfidence(patternId: string, confidence: number): void {
    const now = new Date().toISOString();

    this.db.transaction((tx) => {
      tx.update(failurePatterns)
        .set({ confidence, updatedAt: now })
        .where(eq(failurePatterns.id, patternId))
        .run();
    });
  }

  close(): void {
    // Shared DB — closing is handled externally.
  }
}

// =====================================================================
// Row Mapping Helpers
// =====================================================================

type DrizzlePatternRow = typeof failurePatterns.$inferSelect;
type DrizzleFixRow = typeof fixHistory.$inferSelect;

function mapPatternRow(row: DrizzlePatternRow): FailurePattern {
  return {
    id: row.id,
    category: row.category as FailureCategory,
    signature: row.signature,
    signaturePattern: row.signaturePattern,
    description: row.description,
    suggestedFix: row.suggestedFix,
    confidence: row.confidence,
    occurrences: row.occurrences,
    resolutions: row.resolutions,
    source: row.source as 'built-in' | 'learned',
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapFixRow(row: DrizzleFixRow): FixRecord {
  return {
    id: row.id,
    patternId: row.patternId,
    runId: row.runId,
    caseName: row.caseName,
    fixDescription: row.fixDescription,
    success: row.success === 1,
    createdAt: row.createdAt,
  };
}
