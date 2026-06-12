/**
 * @module tools/patterns
 * argus_patterns — Browse failure patterns in the knowledge base with optional filtering.
 */

import type { SessionManager } from '../session.js';
import type { FailureCategory, FailurePattern } from 'argusai-core';

export interface PatternsParams {
  projectPath: string;
  category?: FailureCategory;
  source?: 'built-in' | 'learned';
  sortBy?: 'confidence' | 'occurrences' | 'lastSeen';
}

export interface PatternsResult {
  patterns: FailurePattern[];
  total: number;
  builtInCount: number;
  learnedCount: number;
}

export async function handlePatterns(
  params: PatternsParams,
  sessionManager: SessionManager,
): Promise<PatternsResult> {
  const session = await sessionManager.ensure(params.projectPath);

  if (!session.knowledgeStore) {
    const { SessionError } = await import('../session.js');
    throw new SessionError('HISTORY_DISABLED', 'History/knowledge base is disabled in project configuration');
  }

  let patterns: FailurePattern[];

  if (params.category) {
    patterns = session.knowledgeStore.findByCategory(params.category);
  } else {
    patterns = session.knowledgeStore.getAllPatterns();
  }

  if (params.source) {
    patterns = patterns.filter((p) => p.source === params.source);
  }

  const sortBy = params.sortBy ?? 'occurrences';
  patterns.sort((a, b) => {
    switch (sortBy) {
      case 'confidence':
        return b.confidence - a.confidence;
      case 'occurrences':
        return b.occurrences - a.occurrences;
      case 'lastSeen':
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      default:
        return 0;
    }
  });

  const builtInCount = patterns.filter((p) => p.source === 'built-in').length;
  const learnedCount = patterns.filter((p) => p.source === 'learned').length;

  return {
    patterns,
    total: patterns.length,
    builtInCount,
    learnedCount,
  };
}
