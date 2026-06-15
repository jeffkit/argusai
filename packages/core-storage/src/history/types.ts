/**
 * @module history/types
 * Type definitions for the test result persistence & trend analysis subsystem.
 */

/** Trigger source for a test run (FR-003). */
export type TriggerSource = 'cli' | 'mcp' | 'dashboard' | 'ci';

/** Stability classification levels (FR-007). */
export type StabilityLevel = 'STABLE' | 'MOSTLY_STABLE' | 'FLAKY' | 'VERY_FLAKY' | 'BROKEN';

/** Persistent record for a complete test run (FR-001). */
export interface TestRunRecord {
  id: string;
  project: string;
  timestamp: number;
  gitCommit: string | null;
  gitBranch: string | null;
  configHash: string;
  trigger: TriggerSource;
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  status: 'passed' | 'failed';
}

/** Persistent record for a single test case outcome (FR-002). */
export interface TestCaseRunRecord {
  id: string;
  runId: string;
  suiteId: string;
  caseName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  attempts: number;
  responseMs: number | null;
  assertions: number | null;
  error: string | null;
  snapshot: string | null;
}

/** Computed flaky analysis result (FR-006, FR-007, FR-008). */
export interface FlakyInfo {
  caseName: string;
  suiteId: string;
  isFlaky: boolean;
  score: number;
  level: StabilityLevel;
  recentResults: Array<'passed' | 'failed' | 'skipped'>;
  suggestion: string;
  failCount: number;
  totalRuns: number;
}

/** A single item in a run comparison showing status changes. */
export interface ComparisonItem {
  caseName: string;
  suiteId: string;
  error?: string | null;
  baseStatus: 'passed' | 'failed' | 'skipped';
  compareStatus: 'passed' | 'failed' | 'skipped';
}

/** Comparison between two test runs (FR-012). */
export interface RunComparison {
  baseRun: TestRunRecord;
  compareRun: TestRunRecord;
  newFailures: ComparisonItem[];
  fixed: ComparisonItem[];
  consistent: { passed: number; failed: number; skipped: number };
  newCases: string[];
  removedCases: string[];
}

/** Daily trend data point for time-series charts. */
export interface TrendDataPoint {
  date: string;
  value: number;
  runCount: number;
}

/** History configuration added to e2e.yaml (FR-014, FR-015). */
export interface HistoryConfig {
  enabled: boolean;
  storage: 'local' | 'memory';
  path?: string;
  retention: {
    maxAge: string;
    maxRuns: number;
  };
  flakyWindow: number;
}

/**
 * Detect the trigger source for a test run.
 * Uses explicit value if provided, falls back to CI env detection, defaults to 'cli'.
 */
export function detectTriggerSource(explicit?: TriggerSource): TriggerSource {
  if (explicit) return explicit;
  if (process.env['CI']) return 'ci';
  return 'cli';
}
