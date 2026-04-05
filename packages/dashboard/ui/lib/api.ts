/**
 * E2E Dashboard API 客户端
 *
 * 基于原版 as-mate/e2e api.ts 迁移，新增分支、presets 等接口。
 */

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  // Only set Content-Type: application/json when there's a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  return res.json() as Promise<T>;
}

// ==================== Docker ====================

export const docker = {
  build: (options?: {
    imageName?: string;
    noCache?: boolean;
    branches?: Record<string, string>;
  }) =>
    request<{ success: boolean; message?: string; error?: string }>('/docker/build', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),

  getBuildStatus: () =>
    request<{
      status: string;
      logs: string[];
      startTime?: number;
      endTime?: number;
      error?: string;
    }>('/docker/build/status'),

  getDefaultImage: () =>
    request<{ imageName: string; version: string; projectName: string }>('/docker/default-image'),

  getBranches: () =>
    request<Record<string, { branches: string[]; current: string; commit: string }>>('/docker/branches'),

  start: (options?: {
    imageName?: string;
    useMockGateway?: boolean;
    envOverrides?: Record<string, string>;
  }) =>
    request<{ success: boolean; status?: string; containerId?: string; error?: string }>(
      '/docker/start',
      { method: 'POST', body: JSON.stringify(options || {}) },
    ),

  stop: () =>
    request<{ success: boolean; error?: string }>('/docker/stop', { method: 'POST' }),

  getStatus: () =>
    request<{ status: string; containers?: unknown[]; containerId?: string }>('/docker/status'),

  getLogs: (lines?: number, service?: string) =>
    request<{ success: boolean; logs?: string; error?: string }>(
      `/docker/logs?lines=${lines || 100}${service ? `&service=${service}` : ''}`,
    ),

  getImages: () =>
    request<{ success: boolean; images?: unknown[]; error?: string }>('/docker/images'),

  getBuildHistory: () =>
    request<{
      builds: Array<{
        id: string;
        imageName: string;
        status: 'success' | 'error';
        startTime: number;
        endTime: number;
        duration: number;
        branches?: Record<string, string>;
        error?: string;
      }>;
    }>('/docker/build/history'),

  runPipeline: (options?: {
    imageName?: string;
    noCache?: boolean;
    branches?: Record<string, string>;
    skipBuild?: boolean;
    skipTests?: boolean;
  }) =>
    request<{ success: boolean; message?: string; error?: string }>('/docker/pipeline/run', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),

  getPipelineState: () =>
    request<{
      status: string;
      stages: Array<{
        id: string;
        name: string;
        status: string;
        startTime?: number;
        endTime?: number;
        error?: string;
        logs: string[];
      }>;
      startTime?: number;
      endTime?: number;
    }>('/docker/pipeline/state'),

  getProcesses: () =>
    request<{ success: boolean; processes?: unknown[]; error?: string }>('/docker/processes'),

  getDirs: (path?: string) =>
    request<{ success: boolean; directories?: unknown[]; error?: string }>(
      `/docker/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),

  exec: (command: string) =>
    request<{ success: boolean; output?: string; exitCode?: number; error?: string }>(
      '/docker/exec',
      { method: 'POST', body: JSON.stringify({ command }) },
    ),
};

// ==================== API Proxy ====================

export const proxy = {
  call: async (method: string, path: string, body?: unknown) => {
    const options: RequestInit = { method };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    return request<unknown>(`/proxy/${path}`, options);
  },
};

// ==================== Tests ====================

export const tests = {
  getSuites: () =>
    request<{
      suites: Array<{
        id: string;
        name: string;
        description: string;
        file: string;
        runner?: string;
      }>;
    }>('/tests/suites'),

  run: (suite?: string, containerUrl?: string) =>
    request<{ success: boolean; testId?: string; error?: string }>('/tests/run', {
      method: 'POST',
      body: JSON.stringify({ suite, containerUrl }),
    }),

  getCurrent: () =>
    request<{
      test: {
        id: string;
        suite: string;
        status: string;
        startTime: number;
        output: string[];
      } | null;
    }>('/tests/current'),

  getHistory: (limit?: number) =>
    request<{
      tests: Array<{
        id: string;
        suite: string;
        status: string;
        startTime: number;
        endTime?: number;
        exitCode?: number;
        output: string[];
      }>;
    }>(`/tests/history?limit=${limit || 20}`),

  getResult: (testId: string) =>
    request<{ success: boolean; test?: unknown; error?: string }>(`/tests/result/${testId}`),

  getSuiteContent: (suiteId: string) =>
    request<{
      success: boolean;
      raw?: string;
      parsed?: {
        name: string;
        description?: string;
        variables?: Record<string, string>;
        setup?: unknown[];
        teardown?: unknown[];
        cases: Array<{
          name: string;
          delay?: string;
          request?: { method: string; path: string; body?: unknown; timeout?: string };
          exec?: { command: string; container?: string };
          file?: {
            path: string;
            exists?: boolean;
            contains?: string | string[];
            notContains?: string | string[];
            matches?: string;
            json?: Record<string, unknown>;
            permissions?: string;
            owner?: string;
            size?: string;
          };
          expect?: {
            status?: number | number[];
            body?: Record<string, unknown>;
            headers?: Record<string, unknown>;
            output?: Record<string, unknown>;
            exitCode?: number;
            expr?: string | string[];
            all?: Array<Record<string, unknown>>;
            any?: Array<Record<string, unknown>>;
          };
          save?: Record<string, string>;
          ignoreError?: boolean;
        }>;
        caseCount: number;
      };
      filePath?: string;
      runner?: string;
      error?: string;
    }>(`/tests/suites/${encodeURIComponent(suiteId)}/content`),

  saveSuiteContent: (suiteId: string, content: string) =>
    request<{ success: boolean; error?: string }>(`/tests/suites/${encodeURIComponent(suiteId)}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  getDiscoveredEndpoints: () =>
    request<{
      endpoints: Array<{
        group: string;
        endpoints: Array<{
          method: string;
          path: string;
          name: string;
          body?: unknown;
        }>;
      }>;
    }>('/tests/discovered-endpoints'),

  getOpenApiEndpoints: (url?: string) =>
    request<{
      success: boolean;
      specUrl?: string;
      info?: { title?: string; version?: string };
      endpoints?: Array<{
        group: string;
        endpoints: Array<{
          method: string;
          path: string;
          name: string;
          description?: string;
          body?: unknown;
          parameters?: Array<{ name: string; in: string; required?: boolean }>;
        }>;
      }>;
      totalEndpoints?: number;
      error?: string;
    }>(`/tests/openapi-endpoints${url ? `?url=${encodeURIComponent(url)}` : ''}`),
};

// ==================== Config ====================

export const config = {
  get: () => request<Record<string, unknown>>('/config'),
  update: (updates: Record<string, unknown>) =>
    request<{ success: boolean }>('/config', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
};

// ==================== Health ====================

export const health = {
  dashboard: () =>
    request<{
      status: string;
      project?: string;
      version?: string;
      containerUrl?: string;
      containerName?: string;
    }>('/health'),
};

// ==================== Projects ====================

export interface ProjectEntry {
  name: string;
  configPath: string;
  description?: string;
  addedAt: string;
}

export const projects = {
  list: () =>
    request<{
      activeProject: string | null;
      currentLoaded: string | null;
      projects: ProjectEntry[];
    }>('/projects'),

  add: (name: string, configPath: string, description?: string) =>
    request<{ success: boolean; registry?: unknown; error?: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, configPath, description }),
    }),

  remove: (name: string) =>
    request<{ success: boolean }>(`/projects/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  activate: (name: string) =>
    request<{
      success: boolean;
      project?: { name: string; description?: string; version?: string; configPath: string };
      error?: string;
    }>(`/projects/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
    }),

  getActive: () =>
    request<{
      active: boolean;
      project?: { name: string; description?: string; version?: string };
      configPath?: string;
    }>('/projects/active'),

  scan: (directory: string) =>
    request<{
      success: boolean;
      found?: Array<{ name: string; configPath: string; description?: string }>;
      error?: string;
    }>('/projects/scan', {
      method: 'POST',
      body: JSON.stringify({ directory }),
    }),

  /** 获取项目的解析后配置（JSON 格式） */
  getParsedConfig: (name: string) =>
    request<{ success: boolean; config?: Record<string, unknown>; error?: string }>(
      `/projects/${encodeURIComponent(name)}/parsed-config`,
    ),

  /** 读取项目的 e2e.yaml 原始内容 */
  getConfigFile: (name: string) =>
    request<{ success: boolean; content?: string; path?: string; error?: string }>(
      `/projects/${encodeURIComponent(name)}/config-file`,
    ),

  /** 保存项目的 e2e.yaml（接收 JSON 对象或原始 YAML） */
  saveConfigFile: (name: string, data: { config?: Record<string, unknown>; raw?: string }) =>
    request<{ success: boolean; error?: string }>(
      `/projects/${encodeURIComponent(name)}/config-file`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  /** 创建新项目（生成 e2e.yaml + 自动注册） */
  create: (directory: string, config: Record<string, unknown>) =>
    request<{ success: boolean; configPath?: string; error?: string }>(
      '/projects/create',
      { method: 'POST', body: JSON.stringify({ directory, config }) },
    ),

  /** 获取 e2e.yaml schema 说明和模板 */
  getSchema: () =>
    request<{
      sections: Array<{
        key: string;
        title: string;
        description: string;
        required: boolean;
        fields: Array<{
          key: string;
          type: string;
          required: boolean;
          description: string;
          example?: string;
        }>;
      }>;
      templates: Record<string, Record<string, unknown>>;
    }>('/projects/schema'),
};

// ==================== Trends & History ====================

export interface PassRateDataPoint {
  date: string;
  passRate: number;
  passed: number;
  failed: number;
  skipped: number;
  runCount: number;
}

export interface DurationDataPoint {
  date: string;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  runCount: number;
}

export interface FlakyCase {
  caseName: string;
  suiteId: string;
  score: number;
  level: string;
  recentResults: string[];
  failCount: number;
  totalRuns: number;
}

export interface FailureDataPoint {
  date: string;
  status: 'passed' | 'failed' | 'skipped' | 'no-run';
  duration: number | null;
  error: string | null;
  runId: string | null;
}

export interface RunRecord {
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
  status: 'passed' | 'failed';
}

export interface CaseRecord {
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

export interface FlakyInfoRecord {
  caseName: string;
  suiteId: string;
  isFlaky: boolean;
  score: number;
  level: string;
  recentResults: string[];
  suggestion: string;
  failCount: number;
  totalRuns: number;
}

export const trends = {
  passRate: (days = 30, suiteId?: string) =>
    request<{
      success: boolean;
      period: { from: string; to: string };
      granularity: string;
      dataPoints: PassRateDataPoint[];
    }>(`/trends/pass-rate?days=${days}${suiteId ? `&suiteId=${encodeURIComponent(suiteId)}` : ''}`),

  duration: (days = 14, suiteId?: string) =>
    request<{
      success: boolean;
      period: { from: string; to: string };
      dataPoints: DurationDataPoint[];
    }>(`/trends/duration?days=${days}${suiteId ? `&suiteId=${encodeURIComponent(suiteId)}` : ''}`),

  flaky: (topN = 10, minScore = 0.01, suiteId?: string) =>
    request<{
      success: boolean;
      cases: FlakyCase[];
      totalFlaky: number;
      analysisWindow: number;
    }>(`/trends/flaky?topN=${topN}&minScore=${minScore}${suiteId ? `&suiteId=${encodeURIComponent(suiteId)}` : ''}`),

  failures: (caseName: string, days = 7, suiteId?: string) =>
    request<{
      success: boolean;
      caseName: string;
      period: { from: string; to: string };
      dataPoints: FailureDataPoint[];
      summary: { totalRuns: number; failures: number; flakyScore: number; level: string };
    }>(`/trends/failures?caseName=${encodeURIComponent(caseName)}&days=${days}${suiteId ? `&suiteId=${encodeURIComponent(suiteId)}` : ''}`),
};

export const runs = {
  list: (limit = 20, offset = 0, status?: string, days?: number) => {
    let url = `/runs?limit=${limit}&offset=${offset}`;
    if (status) url += `&status=${status}`;
    if (days) url += `&days=${days}`;
    return request<{
      success: boolean;
      runs: RunRecord[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(url);
  },

  detail: (id: string) =>
    request<{
      success: boolean;
      run: RunRecord;
      cases: CaseRecord[];
      flaky: FlakyInfoRecord[];
    }>(`/runs/${encodeURIComponent(id)}`),

  compare: (baseId: string, compareId: string) =>
    request<{
      success: boolean;
      baseRun: RunRecord;
      compareRun: RunRecord;
      newFailures: Array<{ caseName: string; suiteId: string; error?: string | null; baseStatus: string; compareStatus: string }>;
      fixed: Array<{ caseName: string; suiteId: string; baseStatus: string; compareStatus: string }>;
      consistent: { passed: number; failed: number; skipped: number };
      newCases: string[];
      removedCases: string[];
    }>(`/runs/${encodeURIComponent(baseId)}/compare/${encodeURIComponent(compareId)}`),
};

// ==================== Activities ====================

export interface ActivityEntry {
  id: string;
  source: 'ai' | 'manual' | 'system';
  operation: string;
  project: string;
  status: 'running' | 'success' | 'failed';
  startTime: number;
  endTime?: number;
  detail?: string;
}

export const activities = {
  list: (limit = 50) =>
    request<{ activities: ActivityEntry[] }>(`/activities?limit=${limit}`),
};
