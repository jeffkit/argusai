/**
 * @module knowledge/knowledge-store
 * KnowledgeStore implementations: SQLiteKnowledgeStore for persistence,
 * NoopKnowledgeStore for disabled/graceful-degradation mode.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  KnowledgeStore,
  FailurePattern,
  FailureCategory,
  FixRecord,
} from './types.js';

// =====================================================================
// Row types for SQLite result mapping
// =====================================================================

interface PatternRow {
  id: string;
  category: string;
  signature: string;
  signature_pattern: string;
  description: string;
  suggested_fix: string;
  confidence: number;
  occurrences: number;
  resolutions: number;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

interface FixRow {
  id: string;
  pattern_id: string;
  run_id: string;
  case_name: string;
  fix_description: string;
  success: number;
  created_at: string;
}

function mapPatternRow(row: PatternRow): FailurePattern {
  return {
    id: row.id,
    category: row.category as FailureCategory,
    signature: row.signature,
    signaturePattern: row.signature_pattern,
    description: row.description,
    suggestedFix: row.suggested_fix,
    confidence: row.confidence,
    occurrences: row.occurrences,
    resolutions: row.resolutions,
    source: row.source as 'built-in' | 'learned',
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFixRow(row: FixRow): FixRecord {
  return {
    id: row.id,
    patternId: row.pattern_id,
    runId: row.run_id,
    caseName: row.case_name,
    fixDescription: row.fix_description,
    success: row.success === 1,
    createdAt: row.created_at,
  };
}

// =====================================================================
// SQLiteKnowledgeStore
// =====================================================================

export class SQLiteKnowledgeStore implements KnowledgeStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findBySignature(signature: string): FailurePattern | null {
    const row = this.db
      .prepare('SELECT * FROM failure_patterns WHERE signature = ?')
      .get(signature) as PatternRow | undefined;
    return row ? mapPatternRow(row) : null;
  }

  findByCategory(category: FailureCategory): FailurePattern[] {
    const rows = this.db
      .prepare('SELECT * FROM failure_patterns WHERE category = ?')
      .all(category) as PatternRow[];
    return rows.map(mapPatternRow);
  }

  findBySource(source: 'built-in' | 'learned'): FailurePattern[] {
    const rows = this.db
      .prepare('SELECT * FROM failure_patterns WHERE source = ?')
      .all(source) as PatternRow[];
    return rows.map(mapPatternRow);
  }

  getAllPatterns(): FailurePattern[] {
    const rows = this.db
      .prepare('SELECT * FROM failure_patterns ORDER BY occurrences DESC')
      .all() as PatternRow[];
    return rows.map(mapPatternRow);
  }

  createPattern(
    pattern: Omit<FailurePattern, 'id' | 'createdAt' | 'updatedAt'>,
  ): FailurePattern {
    const id = randomUUID();
    const now = new Date().toISOString();

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO failure_patterns
            (id, category, signature, signature_pattern, description, suggested_fix,
             confidence, occurrences, resolutions, source, first_seen_at, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          pattern.category,
          pattern.signature,
          pattern.signaturePattern,
          pattern.description,
          pattern.suggestedFix,
          pattern.confidence,
          pattern.occurrences,
          pattern.resolutions,
          pattern.source,
          pattern.firstSeenAt,
          pattern.lastSeenAt,
          now,
          now,
        );
    });
    insert();

    return {
      ...pattern,
      id,
      createdAt: now,
      updatedAt: now,
    };
  }

  incrementOccurrences(patternId: string): void {
    const now = new Date().toISOString();
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE failure_patterns
           SET occurrences = occurrences + 1, last_seen_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, now, patternId);
    });
    update();
  }

  recordFix(fix: Omit<FixRecord, 'id' | 'createdAt'>): FixRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO fix_history (id, pattern_id, run_id, case_name, fix_description, success, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, fix.patternId, fix.runId, fix.caseName, fix.fixDescription, fix.success ? 1 : 0, now);
    });
    insert();

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
      .prepare(
        'SELECT * FROM fix_history WHERE pattern_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      )
      .all(patternId, limit) as FixRow[];
    return rows.map(mapFixRow);
  }

  updateConfidence(patternId: string, confidence: number): void {
    const now = new Date().toISOString();
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE failure_patterns SET confidence = ?, updated_at = ? WHERE id = ?',
        )
        .run(confidence, now, patternId);
    });
    update();
  }

  close(): void {
    // Knowledge store shares the DB with history; closing is handled by history-store.
    // This is a no-op to avoid double-close.
  }
}

// =====================================================================
// NoopKnowledgeStore — used when history is disabled
// =====================================================================

export class NoopKnowledgeStore implements KnowledgeStore {
  findBySignature(): FailurePattern | null { return null; }
  findByCategory(): FailurePattern[] { return []; }
  findBySource(): FailurePattern[] { return []; }
  getAllPatterns(): FailurePattern[] { return []; }
  createPattern(pattern: Omit<FailurePattern, 'id' | 'createdAt' | 'updatedAt'>): FailurePattern {
    return { ...pattern, id: '', createdAt: '', updatedAt: '' };
  }
  incrementOccurrences(): void { /* no-op */ }
  recordFix(fix: Omit<FixRecord, 'id' | 'createdAt'>): FixRecord {
    return { ...fix, id: '', createdAt: '' };
  }
  getFixHistory(): FixRecord[] { return []; }
  updateConfidence(): void { /* no-op */ }
  close(): void { /* no-op */ }
}
