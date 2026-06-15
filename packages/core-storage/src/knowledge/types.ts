/**
 * @module knowledge/types
 * Type definitions for the intelligent diagnostics & knowledge base subsystem.
 */

import type { DiagnosticReport } from '../shared-types.js';

/** The 10 failure categories for classification (FR-001). */
export type FailureCategory =
  | 'ASSERTION_MISMATCH'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'CONNECTION_REFUSED'
  | 'CONTAINER_OOM'
  | 'CONTAINER_CRASH'
  | 'MOCK_MISMATCH'
  | 'CONFIG_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

/** Input event extracted from a failed test case run. */
export interface FailureEvent {
  runId: string;
  caseName: string;
  suiteId: string;
  error: string;
  status: number | null;
  containerStatus: string | null;
  oomKilled: boolean;
  diagnostics: DiagnosticReport | null;
}

/** A single rule in the classification chain (first match wins). */
export interface ClassificationRule {
  readonly name: string;
  readonly category: FailureCategory;
  match(event: FailureEvent): boolean;
}

/** Core knowledge entity stored in `failure_patterns` table. */
export interface FailurePattern {
  id: string;
  category: FailureCategory;
  signature: string;
  signaturePattern: string;
  description: string;
  suggestedFix: string;
  confidence: number;
  occurrences: number;
  resolutions: number;
  source: 'built-in' | 'learned';
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A historical fix attempt stored in `fix_history` table. */
export interface FixRecord {
  id: string;
  patternId: string;
  runId: string;
  caseName: string;
  fixDescription: string;
  success: boolean;
  createdAt: string;
}

/** Output of the full diagnostic workflow. */
export interface DiagnosticResult {
  category: FailureCategory;
  signature: string;
  signaturePattern: string;
  pattern: FailurePattern | null;
  suggestedFix: string | null;
  confidence: number | null;
  fixHistory: FixRecord[];
  isNewPattern: boolean;
}

/** Result of reporting a fix back to the knowledge base. */
export interface ReportFixResult {
  patternId: string;
  category: FailureCategory;
  previousConfidence: number | null;
  updatedConfidence: number;
  occurrences: number;
  resolutions: number;
  fixRecordId: string;
  isNewPattern: boolean;
}

/** Persistence interface for the knowledge base. */
export interface KnowledgeStore {
  findBySignature(signature: string): FailurePattern | null;
  findByCategory(category: FailureCategory): FailurePattern[];
  findBySource(source: 'built-in' | 'learned'): FailurePattern[];
  getAllPatterns(): FailurePattern[];
  createPattern(pattern: Omit<FailurePattern, 'id' | 'createdAt' | 'updatedAt'>): FailurePattern;
  incrementOccurrences(patternId: string): void;
  recordFix(fix: Omit<FixRecord, 'id' | 'createdAt'>): FixRecord;
  getFixHistory(patternId: string, limit?: number): FixRecord[];
  updateConfidence(patternId: string, confidence: number): void;
  close(): void;
}
