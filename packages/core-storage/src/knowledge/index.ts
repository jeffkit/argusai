/**
 * @module knowledge
 * Intelligent diagnostics & knowledge base subsystem.
 */

export type {
  FailureCategory,
  FailureEvent,
  ClassificationRule,
  FailurePattern,
  FixRecord,
  DiagnosticResult,
  ReportFixResult,
  KnowledgeStore,
} from './types.js';

export { FailureClassifier, DEFAULT_RULES, createDefaultClassifier } from './classifier.js';
export { normalizeError, generateSignature } from './normalizer.js';
export { SQLiteKnowledgeStore, NoopKnowledgeStore } from './knowledge-store.js';
export { BUILT_IN_PATTERNS } from './built-in-patterns.js';
export { DiagnosticsEngine } from './diagnostics-engine.js';
