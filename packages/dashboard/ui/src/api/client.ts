const API_KEY_STORAGE_KEY = 'argusai-api-key';
const TEAMS_STORAGE_KEY = 'argusai-teams';

export interface TeamEntry {
  name: string;
  apiKeyPrefix: string;
  apiKey: string;
}

function getBaseUrl(): string {
  // @ts-ignore Vite env
  return (import.meta as any).env?.VITE_API_BASE_URL || '/api';
}

function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export function getStoredTeams(): TeamEntry[] {
  try {
    return JSON.parse(localStorage.getItem(TEAMS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addStoredTeam(team: TeamEntry): void {
  const teams = getStoredTeams().filter((t) => t.apiKey !== team.apiKey);
  teams.unshift(team);
  localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(teams));
}

export function switchTeam(apiKey: string): void {
  setApiKey(apiKey);
}

export function isAuthRequired(): boolean {
  // @ts-ignore Vite env
  return (import.meta as any).env?.VITE_AUTH_REQUIRED === 'true';
}

export function isAuthenticated(): boolean {
  return !!getApiKey();
}

async function serverRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const headers: Record<string, string> = {};
  const apiKey = getApiKey();

  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${base}${path}`, {
    headers,
    ...options,
  });

  if (res.status === 401) {
    clearApiKey();
    window.dispatchEvent(new CustomEvent('argusai:auth-required'));
    throw new Error('Authentication required');
  }

  return res.json() as Promise<T>;
}

export const serverApi = {
  getTeam: () =>
    serverRequest<{
      success: boolean;
      team: {
        id: string;
        name: string;
        apiKeyPrefix: string;
        projectCount: number;
        totalRuns: number;
        createdAt: string;
      };
    }>('/teams'),

  getProjects: (limit = 50, offset = 0) =>
    serverRequest<{
      success: boolean;
      projects: Array<{
        id: string;
        name: string;
        description: string | null;
        totalRuns: number;
        lastSyncAt: string | null;
        lastRunStatus: string | null;
        lastPassRate: number | null;
        createdAt: string;
      }>;
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(`/projects?limit=${limit}&offset=${offset}`),

  getProjectDetail: (name: string) =>
    serverRequest<{
      success: boolean;
      project: {
        id: string;
        name: string;
        description: string | null;
        totalRuns: number;
        lastSyncAt: string | null;
        recentPassRate: number | null;
        totalFlakyTests: number;
        activeDevelopers: number;
        createdAt: string;
      };
    }>(`/projects/${encodeURIComponent(name)}`),

  getRuns: (project: string, options?: { limit?: number; offset?: number; status?: string; days?: number }) => {
    const params = new URLSearchParams({ project });
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.status) params.set('status', options.status);
    if (options?.days) params.set('days', String(options.days));
    return serverRequest<{
      success: boolean;
      runs: Array<{
        id: string;
        project: string;
        timestamp: number;
        gitCommit: string | null;
        gitBranch: string | null;
        configHash: string;
        trigger: string;
        duration: number;
        passed: number;
        failed: number;
        skipped: number;
        flaky: number;
        status: string;
        sourceDeveloper: string | null;
        syncedAt: string | null;
      }>;
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(`/runs?${params.toString()}`);
  },

  getRunById: (id: string) =>
    serverRequest<{
      success: boolean;
      run: any;
      cases: any[];
      flaky: any[];
    }>(`/runs/${encodeURIComponent(id)}`),

  compareRuns: (run1: string, run2: string) =>
    serverRequest<{
      success: boolean;
      baseRun: any;
      compareRun: any;
      newFailures: any[];
      fixed: any[];
      consistent: { passed: number; failed: number; skipped: number };
      newCases: string[];
      removedCases: string[];
    }>(`/runs/compare?run1=${encodeURIComponent(run1)}&run2=${encodeURIComponent(run2)}`),

  getTrends: {
    passRate: (project: string, days = 30) =>
      serverRequest<{
        success: boolean;
        period: { from: string; to: string };
        granularity: string;
        dataPoints: Array<{
          date: string;
          passRate: number;
          passed: number;
          failed: number;
          skipped: number;
          runCount: number;
        }>;
      }>(`/trends/pass-rate?project=${encodeURIComponent(project)}&days=${days}`),

    duration: (project: string, days = 30) =>
      serverRequest<{
        success: boolean;
        period: { from: string; to: string };
        dataPoints: Array<{
          date: string;
          avgDuration: number;
          minDuration: number;
          maxDuration: number;
          runCount: number;
        }>;
      }>(`/trends/duration?project=${encodeURIComponent(project)}&days=${days}`),

    flaky: (project: string, topN = 10) =>
      serverRequest<{
        success: boolean;
        cases: Array<{
          caseName: string;
          suiteId: string;
          score: number;
          level: string;
          recentResults: string[];
          failCount: number;
          totalRuns: number;
        }>;
        totalFlaky: number;
        analysisWindow: number;
      }>(`/trends/flaky?project=${encodeURIComponent(project)}&topN=${topN}`),

    failures: (project: string, caseName: string, days = 7) =>
      serverRequest<{
        success: boolean;
        caseName: string;
        period: { from: string; to: string };
        dataPoints: any[];
        summary: { totalRuns: number; failures: number; flakyScore: number; level: string };
      }>(`/trends/failures?project=${encodeURIComponent(project)}&caseName=${encodeURIComponent(caseName)}&days=${days}`),
  },

  getPatterns: (project?: string) => {
    const params = new URLSearchParams();
    if (project) params.set('project', project);
    return serverRequest<{
      success: boolean;
      patterns: any[];
      total: number;
    }>(`/patterns?${params.toString()}`);
  },

  getNotifications: (teamId: string) =>
    serverRequest<{
      success: boolean;
      config: {
        webhookUrl: string | null;
        onFailure: boolean;
        onSuccess: boolean;
        onNewFlaky: boolean;
        dailyDigest: boolean;
        digestTime: string;
        digestTimezone: string;
      };
    }>(`/teams/${encodeURIComponent(teamId)}/notifications`),

  updateNotifications: (teamId: string, config: Record<string, any>) =>
    serverRequest<{
      success: boolean;
      config: any;
    }>(`/teams/${encodeURIComponent(teamId)}/notifications`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  health: () =>
    serverRequest<{
      status: string;
      service: string;
      version: string;
      uptime: number;
      database: string;
      timestamp: string;
    }>('/health'),
};
