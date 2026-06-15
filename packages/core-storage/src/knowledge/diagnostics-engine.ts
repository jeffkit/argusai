/**
 * @module knowledge/diagnostics-engine
 * DiagnosticsEngine — orchestrates classify → normalize → sign → match → suggest.
 * Implements category-based fallback for built-in pattern matching.
 */

import type {
  FailureEvent,
  DiagnosticResult,
  ReportFixResult,
  KnowledgeStore,
  FailurePattern,
} from './types.js';
import type { FailureClassifier } from './classifier.js';
import { generateSignature } from './normalizer.js';

/**
 * Recalculate confidence using Laplace smoothing.
 * Formula: (resolutions + 1) / (occurrences + 2)
 */
function recalculateConfidence(occurrences: number, resolutions: number): number {
  return (resolutions + 1) / (occurrences + 2);
}

export class DiagnosticsEngine {
  constructor(
    private readonly classifier: FailureClassifier,
    private readonly store: KnowledgeStore,
  ) {}

  /**
   * Full diagnostic workflow for a failure event.
   * 1. Classify → category
   * 2. Normalize + sign → signature
   * 3. Find by exact signature match
   * 4. Fallback: find by category filtered to source='built-in'
   * 5. If match: increment occurrences, return suggestion
   * 6. If no match: auto-create learned pattern
   */
  diagnose(event: FailureEvent): DiagnosticResult {
    const category = this.classifier.classify(event);
    const { signature, signaturePattern } = generateSignature(
      category,
      event.caseName,
      event.error,
    );

    try {
      // Step 3: exact signature match
      let pattern: FailurePattern | null = this.store.findBySignature(signature);

      // Step 4: category-based fallback for built-in patterns
      if (!pattern) {
        const builtInCandidates = this.store
          .findByCategory(category)
          .filter((p) => p.source === 'built-in');
        if (builtInCandidates.length > 0) {
          pattern = builtInCandidates[0]!;
        }
      }

      if (pattern) {
        this.store.incrementOccurrences(pattern.id);
        const fixHistory = this.store.getFixHistory(pattern.id, 10);
        return {
          category,
          signature,
          signaturePattern,
          pattern,
          suggestedFix: pattern.suggestedFix,
          confidence: pattern.confidence,
          fixHistory,
          isNewPattern: false,
        };
      }

      // Step 6: no match at all — create new learned pattern
      const now = new Date().toISOString();
      const newPattern = this.store.createPattern({
        category,
        signature,
        signaturePattern,
        description: '',
        suggestedFix: '',
        confidence: recalculateConfidence(1, 0),
        occurrences: 1,
        resolutions: 0,
        source: 'learned',
        firstSeenAt: now,
        lastSeenAt: now,
      });

      return {
        category,
        signature,
        signaturePattern,
        pattern: newPattern,
        suggestedFix: null,
        confidence: null,
        fixHistory: [],
        isNewPattern: true,
      };
    } catch {
      // Graceful degradation: return classification-only result
      return {
        category,
        signature,
        signaturePattern,
        pattern: null,
        suggestedFix: null,
        confidence: null,
        fixHistory: [],
        isNewPattern: false,
      };
    }
  }

  /**
   * Report a fix for a failure event. Updates the knowledge base.
   * 1. Classify + sign
   * 2. Find or create pattern
   * 3. Record fix
   * 4. If success: increment resolutions + recalculate confidence
   * 5. Return updated stats
   */
  reportFix(
    event: FailureEvent,
    fixDescription: string,
    success: boolean,
  ): ReportFixResult {
    const category = this.classifier.classify(event);
    const { signature, signaturePattern } = generateSignature(
      category,
      event.caseName,
      event.error,
    );

    // Find or create pattern (same fallback logic as diagnose)
    let pattern: FailurePattern | null = this.store.findBySignature(signature);
    let isNewPattern = false;

    if (!pattern) {
      const builtInCandidates = this.store
        .findByCategory(category)
        .filter((p) => p.source === 'built-in');
      if (builtInCandidates.length > 0) {
        pattern = builtInCandidates[0]!;
      }
    }

    if (!pattern) {
      const now = new Date().toISOString();
      pattern = this.store.createPattern({
        category,
        signature,
        signaturePattern,
        description: '',
        suggestedFix: '',
        confidence: recalculateConfidence(1, 0),
        occurrences: 1,
        resolutions: 0,
        source: 'learned',
        firstSeenAt: now,
        lastSeenAt: now,
      });
      isNewPattern = true;
    }

    const previousConfidence = isNewPattern ? null : pattern.confidence;

    const fixRecord = this.store.recordFix({
      patternId: pattern.id,
      runId: event.runId,
      caseName: event.caseName,
      fixDescription,
      success,
    });

    let updatedConfidence = pattern.confidence;
    let resolutions = pattern.resolutions;

    if (success) {
      resolutions = pattern.resolutions + 1;
      updatedConfidence = recalculateConfidence(pattern.occurrences, resolutions);
      this.store.updateConfidence(pattern.id, updatedConfidence);
    }

    return {
      patternId: pattern.id,
      category,
      previousConfidence,
      updatedConfidence,
      occurrences: pattern.occurrences,
      resolutions,
      fixRecordId: fixRecord.id,
      isNewPattern,
    };
  }
}
