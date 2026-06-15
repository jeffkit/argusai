/**
 * @module shared-types
 * Minimal type definitions that core-storage needs from the wider ArgusAI
 * type system. These are intentionally duplicated here to avoid a circular
 * dependency between argusai-core-storage and argusai-core.
 *
 * Keep this file small. If it grows, extract to a dedicated argusai-core-types
 * package that both core and core-storage can depend on.
 */

/** Server sync configuration (mirrors argusai-core ServerConfig). */
export interface ServerConfig {
  url: string;
  apiKey: string;
  team: string;
  sync: 'auto' | 'manual' | 'disabled';
}

/** Diagnostic information collected on test failure (mirrors argusai-core DiagnosticReport). */
export interface DiagnosticReport {
  containerLogs: Array<{ container: string; lines: string[] }>;
  containerHealth: Array<{ container: string; status: string; detail?: string }>;
  mockRequests: Array<{
    mockName: string;
    method: string;
    path: string;
    body?: unknown;
    timestamp: number;
  }>;
  collectedAt: number;
}
