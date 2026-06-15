import type { TestRunRecord, TestCaseRunRecord } from '../history/types.js';

// =====================================================================
// Sync Payload Types (matching sync-api.md contract)
// =====================================================================

export interface SyncRunsPayload {
  project: string;
  team: string;
  sourceDeveloper?: string;
  run: {
    id: string;
    timestamp: number;
    gitCommit: string | null;
    gitBranch: string | null;
    configHash: string;
    trigger: 'cli' | 'mcp' | 'dashboard' | 'ci';
    duration: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    status: 'passed' | 'failed';
  };
  cases: Array<{
    id: string;
    suiteId: string;
    caseName: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    attempts: number;
    responseMs: number | null;
    assertions: number | null;
    error: string | null;
    snapshot: string | null;
  }>;
  patterns?: Array<{
    category: string;
    signature: string;
    signaturePattern: string;
    description: string;
    suggestedFix: string;
    confidence: number;
    source: 'built-in' | 'learned';
  }>;
}

export interface SyncRunsResponse {
  success: boolean;
  result: {
    runStatus: 'created' | 'already_exists';
    projectStatus: 'created' | 'existing';
    casesStored: number;
    patternsStored: number;
    patternsDeduped: number;
    notificationsTriggered: string[];
  };
}

export interface SyncPatternsPayload {
  project: string;
  team: string;
  patterns: Array<{
    category: string;
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
  }>;
  fixes?: Array<{
    patternSignature: string;
    runId: string;
    caseName: string;
    fixDescription: string;
    success: boolean;
    createdAt: string;
  }>;
}

export interface SyncPatternsResponse {
  success: boolean;
  result: {
    patternsCreated: number;
    patternsUpdated: number;
    fixesStored: number;
  };
}

/**
 * HTTP client for communicating with the ArgusAI Server sync endpoints.
 * Uses native `fetch` (Node 20+).
 */
export class SyncClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(serverUrl: string, apiKey: string) {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async syncRuns(payload: SyncRunsPayload): Promise<SyncRunsResponse> {
    const response = await this.post('/api/sync/runs', payload);
    return response as SyncRunsResponse;
  }

  async syncPatterns(payload: SyncPatternsPayload): Promise<SyncPatternsResponse> {
    const response = await this.post('/api/sync/patterns', payload);
    return response as SyncPatternsResponse;
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        headers: { 'X-API-Key': this.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = (data as { error?: string }).error ?? `HTTP ${response.status}`;
      throw new Error(`Sync request failed: ${errorMsg} (status ${response.status})`);
    }

    return data;
  }
}
