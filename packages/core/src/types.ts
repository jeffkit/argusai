// ==================== History Types (re-exported) ====================

import type { HistoryConfig as _HistoryConfig } from './history/types.js';

export type {
  TriggerSource,
  StabilityLevel,
  TestRunRecord,
  TestCaseRunRecord,
  FlakyInfo,
  RunComparison,
  ComparisonItem,
  TrendDataPoint,
  HistoryConfig,
} from './history/types.js';

// ==================== Knowledge Types (re-exported) ====================

export type {
  FailureCategory,
  FailurePattern,
  FixRecord,
  DiagnosticResult,
} from './knowledge/types.js';

// ==================== 配置类型 ====================

/** 健康检查配置 */
export interface HealthcheckConfig {
  /** HTTP 健康检查路径 */
  path: string;
  /** 容器内端口（未指定时从 container ports 自动推断） */
  port?: number;
  /** 检查间隔 */
  interval?: string;
  /** 超时时间 */
  timeout?: string;
  /** 重试次数 */
  retries?: number;
  /** 启动等待期 */
  startPeriod?: string;
}

/** 服务构建配置 */
export interface ServiceBuildConfig {
  /** Dockerfile 路径 */
  dockerfile: string;
  /** 构建上下文 */
  context: string;
  /** 镜像名（支持变量） */
  image: string;
  /** 构建参数 */
  args?: Record<string, string>;
}

/** 服务容器配置 */
export interface ServiceContainerConfig {
  /** 容器名 */
  name: string;
  /** 端口映射 host:container */
  ports: string[];
  /** 环境变量 */
  environment?: Record<string, string>;
  /** Volume 挂载 */
  volumes?: string[];
  /** 健康检查 */
  healthcheck?: HealthcheckConfig;
}

/** 服务配置 */
export interface ServiceConfig {
  build: ServiceBuildConfig;
  container: ServiceContainerConfig;
  /** 自定义变量 */
  vars?: Record<string, string>;
}

/** Mock 路由配置 */
export interface MockRouteConfig {
  method: string;
  path: string;
  response: {
    status: number;
    headers?: Record<string, string>;
    body: unknown;
    delay?: string;
  };
  when?: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  };
}

/** Mock operating mode for OpenAPI-backed mocks */
export type MockMode = 'auto' | 'record' | 'replay' | 'smart';

/** Mock 服务配置 */
export interface MockServiceConfig {
  /** 宿主机端口 */
  port: number;
  /** 容器内端口 */
  containerPort?: number;
  /** Mock 路由 */
  routes?: MockRouteConfig[];
  /** 或使用已有镜像 */
  image?: string;
  /** Path to OpenAPI 3.x spec file (YAML or JSON), relative to e2e.yaml */
  openapi?: string;
  /** Mock operating mode: auto, record, replay, smart */
  mode?: MockMode;
  /** Enable request validation against OpenAPI spec */
  validate?: boolean;
  /** Real API base URL for record mode proxying */
  target?: string;
  /** Directory for storing recorded request/response pairs */
  recordingsDir?: string;
  /** Maximum nesting depth for circular $ref resolution */
  maxDepth?: number;
  /** Manual override routes that take precedence over auto-generated routes */
  overrides?: MockRouteConfig[];
}

/** 测试套件配置 */
export interface TestSuiteConfig {
  name: string;
  id: string;
  /** 测试文件路径 */
  file?: string;
  /** 运行器类型 (yaml, vitest, pytest, shell, exec, playwright) */
  runner?: string;
  /** 自定义命令 */
  command?: string;
  /** Vitest 配置文件 */
  config?: string;
  /** Suite-level retry policy override */
  retry?: RetryPolicy;
  /** Enable parallel execution for this suite */
  parallel?: boolean;
  /** Maximum concurrency for this suite's cases */
  concurrency?: number;
}

/** 预定义 API 端点 */
export interface PresetEndpoint {
  method: string;
  path: string;
  name: string;
  body?: unknown;
}

/** 预定义 API 端点分组 */
export interface PresetGroup {
  group: string;
  endpoints: PresetEndpoint[];
}

/** Git 仓库配置 */
export interface RepoConfig {
  name: string;
  /** 本地路径（相对于 e2e.yaml 目录） */
  path?: string;
  /** 远程仓库 URL（SSH 或 HTTPS） */
  url?: string;
  /** 默认分支名（远程仓库模式使用） */
  branch?: string;
}

/** Dashboard 配置 */
export interface DashboardConfig {
  port: number;
  uiPort?: number;
  /** 预定义 API 端点 */
  presets?: PresetGroup[];
  /** 环境变量编辑器默认值 */
  envDefaults?: Record<string, string>;
  /** 容器内默认浏览目录 */
  defaultDirs?: string[];
}

/** 网络配置 */
export interface NetworkConfig {
  name: string;
}

/** 顶层配置 */
export interface E2EConfig {
  version: string;
  project: { name: string; description?: string; version?: string };
  /** Single service (backward compatible) */
  service?: ServiceConfig;
  /** Multiple services (new, takes precedence over service) */
  services?: ServiceDefinition[];
  mocks?: Record<string, MockServiceConfig>;
  tests?: {
    suites: TestSuiteConfig[];
    /** Global retry policy (applies to all cases without case-level retry) */
    retry?: RetryPolicy;
    /** Global parallel execution config */
    parallel?: ParallelConfig;
  };
  dashboard?: DashboardConfig;
  network?: NetworkConfig;
  /** Git 仓库列表（用于分支选择与构建前 checkout） */
  repos?: RepoConfig[];
  /** Resilience subsystem configuration (error recovery, preflight, circuit breaker) */
  resilience?: ResilienceConfig;
  /** History subsystem configuration (test result persistence, flaky detection) */
  history?: _HistoryConfig;
  /** Multi-project isolation configuration */
  isolation?: IsolationConfig;
}

// ==================== Isolation Config ====================

/** Multi-project isolation and resource namespace configuration. */
export interface IsolationConfig {
  /**
   * Custom namespace prefix for Docker resources (containers, networks).
   * Defaults to a slug derived from the project name.
   * Used to prevent resource name collisions when multiple projects run simultaneously.
   */
  namespace?: string;
  /**
   * Port allocation range [start, end] (inclusive) for auto-assignment.
   * When PortResolver needs to reassign a conflicting port, it picks from this range.
   * Defaults to [9000, 9999].
   */
  portRange?: [number, number];
}

// ==================== Resilience Config ====================

/** Resilience subsystem configuration. */
export interface ResilienceConfig {
  preflight: {
    enabled: boolean;
    diskSpaceThreshold: string;
    cleanOrphans: boolean;
  };
  container: {
    restartOnFailure: boolean;
    maxRestarts: number;
    restartDelay: string;
    restartBackoff: 'exponential' | 'linear';
  };
  network: {
    portConflictStrategy: 'auto' | 'fail';
    verifyConnectivity: boolean;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeoutMs: number;
  };
}

// ==================== Preflight Health Check ====================

/** Result status of an individual preflight check. */
export type CheckStatus = 'pass' | 'warn' | 'fail';

/** Aggregate health assessment. */
export type OverallHealth = 'healthy' | 'degraded' | 'unhealthy';

/** Result of a single preflight health check. */
export interface HealthCheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details: Record<string, unknown>;
  duration: number;
}

/** Aggregated preflight health report. */
export interface HealthReport {
  overall: OverallHealth;
  checks: HealthCheckResult[];
  timestamp: number;
  duration: number;
}

// ==================== Port Mapping ====================

/** Mapping from original configured port to actual resolved port. */
export interface PortMapping {
  service: string;
  originalPort: number;
  actualPort: number;
  reassigned: boolean;
}

// ==================== Container Diagnostics ====================

/** Diagnostic snapshot captured before a container restart attempt. */
export interface ContainerDiagnostics {
  containerId: string;
  containerName: string;
  exitCode: number | null;
  oomKilled: boolean;
  logs: string[];
  memoryStats: { limit: number; peak: number } | null;
  timestamp: number;
}

/** Full history of restart attempts for a single container. */
export interface RestartHistory {
  containerName: string;
  attempts: Array<ContainerDiagnostics & { attemptNumber: number; delayMs: number }>;
  finalStatus: 'recovered' | 'exhausted';
}

// ==================== Orphan Resources ====================

/** A Docker resource left over from a previous ArgusAI run. */
export interface OrphanResource {
  type: 'container' | 'network' | 'volume';
  name: string;
  id: string;
  project: string;
  runId: string;
  createdAt: string;
}

/** Result of an orphan detection + cleanup cycle. */
export interface OrphanCleanupResult {
  found: OrphanResource[];
  removed: OrphanResource[];
  failed: Array<OrphanResource & { error: string }>;
  duration: number;
}

// ==================== Circuit Breaker ====================

/** Circuit breaker state machine states. */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Full observable state of a circuit breaker instance. */
export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  lastStateTransition: number;
  failureHistory: Array<{ error: string; timestamp: number }>;
}

// ==================== Network Verification ====================

/** Result of a single container-to-service connectivity check. */
export interface ConnectivityResult {
  service: string;
  hostname: string;
  reachable: boolean;
  dnsResolved: boolean;
  latencyMs: number;
  error?: string;
}

/** Report from verifying network connectivity between containers and mock services. */
export interface NetworkVerificationReport {
  results: ConnectivityResult[];
  allReachable: boolean;
  networkTopology: {
    networkName: string;
    connectedContainers: string[];
  };
  timestamp: number;
}

// ==================== 测试类型 ====================

/** 文件断言配置 */
export interface FileAssertConfig {
  /** 容器内文件路径 */
  path: string;
  /** 覆盖默认容器名 */
  container?: string;
  /** 断言文件存在 */
  exists?: boolean;
  /** 断言文件内容包含 */
  contains?: string | string[];
  /** 断言文件内容不包含 */
  notContains?: string | string[];
  /** 正则匹配文件内容 */
  matches?: string;
  /** 解析为 JSON 并断言字段 */
  json?: Record<string, unknown>;
  /** 检查文件权限（如 "-rwxr-xr-x"） */
  permissions?: string;
  /** 检查文件所有者 */
  owner?: string;
  /** 检查文件大小（支持 ">0", "<1024" 等） */
  size?: string;
}

/** 进程断言配置 */
export interface ProcessAssertConfig {
  /** 进程名或匹配模式（用于 grep） */
  name: string;
  /** 覆盖默认容器名 */
  container?: string;
  /** 断言进程是否在运行 */
  running?: boolean;
  /** 断言进程数量 */
  count?: string; // e.g. ">0", "==1", ">=2"
  /** 断言进程用户 */
  user?: string;
}

/** 端口断言配置 */
export interface PortAssertConfig {
  /** 要检查的端口号 */
  port: number;
  /** 主机名（默认 localhost） */
  host?: string;
  /** 覆盖默认容器名 */
  container?: string;
  /** 断言端口是否监听 */
  listening?: boolean;
  /** 超时时间（默认 5s） */
  timeout?: string;
}

/** 浏览器动作类型 */
export type BrowserActionType =
  | 'goto'
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'focus'
  | 'clear'
  | 'waitForSelector'
  | 'waitForURL'
  | 'waitForLoadState'
  | 'screenshot'
  | 'evaluate'
  | 'setLocalStorage'
  | 'scrollTo';

/** 浏览器操作配置 */
export interface BrowserAction {
  action: BrowserActionType;
  /** 元素选择器 (CSS/text=/role= Playwright 选择器) */
  selector?: string;
  /** goto 的目标 URL */
  url?: string;
  /** fill/type 的输入值 */
  value?: string;
  /** press 的按键名 (e.g. "Enter", "Tab") */
  key?: string;
  /** select 的选项值或标签 */
  option?: string | { value?: string; label?: string; index?: number };
  /** evaluate 的 JavaScript 代码 */
  script?: string;
  /** screenshot 的保存路径 */
  path?: string;
  /** setLocalStorage 的键值对 */
  storage?: Record<string, string>;
  /** 操作超时（默认 30s） */
  timeout?: string;
  /** waitForLoadState 的状态 */
  state?: 'load' | 'domcontentloaded' | 'networkidle';
  /** scrollTo 的坐标或元素 */
  position?: { x: number; y: number };
}

/** 页面状态断言 */
export interface PageExpect {
  /** URL 断言 */
  url?: string | { contains?: string; notContains?: string; matches?: string; startsWith?: string };
  /** 页面标题断言 */
  title?: string | { contains?: string; matches?: string };
  /** 应可见的元素选择器列表 */
  visible?: string[];
  /** 应不可见/不存在的元素选择器列表 */
  hidden?: string[];
  /** 特定选择器的文本内容断言 */
  text?: Record<string, string | { contains?: string; matches?: string }>;
  /** 特定选择器的输入值断言 */
  inputValue?: Record<string, string>;
  /** 特定选择器的元素数量断言 */
  count?: Record<string, number | { gt?: number; gte?: number; lt?: number; lte?: number }>;
  /** evaluate 的返回值断言 */
  result?: unknown;
}

/** YAML 测试用例步骤 */
export interface TestStep {
  name: string;
  /** 请求前延迟 */
  delay?: string;
  /** HTTP 请求 */
  request?: {
    method: string;
    path: string;
    /** 可选：使用完整 URL 替代 baseUrl + path */
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: string;
  };
  /** 容器内命令执行 */
  exec?: {
    command: string;
    /** 覆盖默认容器名 */
    container?: string;
  };
  /** 容器内文件断言（语义化，底层使用 docker exec） */
  file?: FileAssertConfig;
  /** 容器内进程断言 */
  process?: ProcessAssertConfig;
  /** 端口监听断言 */
  port?: PortAssertConfig;
  /** SSE (Server-Sent Events) 流消费 */
  sse?: {
    /** SSE 端点 URL（完整 URL） */
    url: string;
    /** POST body（如果需要 POST 方式发起 SSE） */
    body?: unknown;
    /** 请求方法（默认 GET；AI 聊天 API 通常用 POST） */
    method?: string;
    /** 请求头 */
    headers?: Record<string, string>;
    /** 最大监听时长（默认 10s） */
    timeout?: string;
  };
  /** 浏览器操作（与 request/exec/sse 互斥） */
  browser?: BrowserAction;
  expect?: {
    status?: number | number[];
    headers?: Record<string, unknown>;
    body?: Record<string, unknown>;
    /** HTTP 响应时间断言（毫秒），支持数值比较操作符 e.g. { lt: 500 } */
    responseTime?: number | Record<string, number>;
    /** exec 步骤的输出断言 */
    output?: {
      /** 输出包含指定字符串 */
      contains?: string | string[];
      /** 输出不包含指定字符串 */
      notContains?: string | string[];
      /** 正则匹配 */
      matches?: string;
      /** 将输出解析为 JSON 并断言 */
      json?: Record<string, unknown>;
      /** 输出行数断言 e.g. ">0" */
      length?: string;
    };
    /** exec 步骤的退出码断言 */
    exitCode?: number;
    /** 表达式断言 - 简易 CEL 风格 */
    expr?: string | string[];
    /** 复合断言 - 全部通过 (AND) */
    all?: Array<Record<string, unknown>>;
    /** 复合断言 - 任一通过 (OR) */
    any?: Array<Record<string, unknown>>;
    /** SSE 事件断言 */
    events?: {
      /** 最小事件数量 */
      minCount?: number;
      /** 最大事件数量 */
      maxCount?: number;
      /** 必须包含的事件类型 */
      types?: string[];
      /** 事件数据包含指定文本 */
      dataContains?: string | string[];
      /** 事件数据不包含指定文本 */
      dataNotContains?: string | string[];
      /** 第一个事件的断言 */
      first?: Record<string, unknown>;
      /** 最后一个事件的断言 */
      last?: Record<string, unknown>;
    };
    /** 浏览器页面状态断言 */
    page?: PageExpect;
  };
  /** 保存响应变量 */
  save?: Record<string, string>;
  /** 忽略错误继续执行 */
  ignoreError?: boolean;
  /** Per-case retry policy (overrides global and suite-level) */
  retry?: RetryPolicy;
}

/** YAML 测试套件定义 */
export interface YAMLTestSuite {
  name: string;
  description?: string;
  sequential?: boolean;
  variables?: Record<string, string>;
  setup?: Array<TestStep | { waitHealthy?: { timeout?: string } } | { waitForPort?: { host?: string; port: number; timeout?: string } } | { delay?: string }>;
  teardown?: Array<TestStep & { ignoreError?: boolean }>;
  cases: TestStep[];
}

// ==================== AI-Native Types ====================

/** Structured test result enriched with full diagnostic context for AI consumption. */
export interface AIFriendlyTestResult {
  name: string;
  suite: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  timestamp: number;

  failure?: {
    error: string;
    summary: string;
    suggestedFix?: string;

    request?: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: unknown;
    };

    response?: {
      status: number;
      headers: Record<string, string>;
      body?: unknown;
    };

    assertions: AssertionResult[];
    diagnostics: DiagnosticReport;
  };

  attempts?: AttemptResult[];
}

/** Container and environment diagnostic data collected on test failure. */
export interface DiagnosticReport {
  containerLogs: Array<{
    containerName: string;
    lines: string[];
    lineCount: number;
  }>;

  containerHealth: Array<{
    containerName: string;
    status: ContainerStatus;
    healthLog?: string;
  }>;

  mockRequests: Array<{
    mockName: string;
    requests: Array<{
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, string | string[] | undefined>;
      timestamp: string;
    }>;
  }>;

  networkInfo?: {
    networkName: string;
    connectedContainers: string[];
  };

  collectedAt: number;
}

/** Configuration for test case retry behavior. */
export interface RetryPolicy {
  maxAttempts: number;
  delay: string;
  backoff?: 'linear' | 'exponential';
  backoffMultiplier?: number;
}

/** Result of a single retry attempt. */
export interface AttemptResult {
  attempt: number;
  passed: boolean;
  error?: string;
  duration: number;
  timestamp: number;
}

/** Configuration for a single service in multi-service orchestration. */
export interface ServiceDefinition {
  name: string;
  build: ServiceBuildConfig;
  container: ServiceContainerConfig;
  vars?: Record<string, string>;
  dependsOn?: string[];
}

/** Suite-level parallel execution configuration. */
export interface ParallelConfig {
  enabled: boolean;
  concurrency?: number;
}

// ==================== 测试事件 ====================

export type TestEvent =
  | { type: 'suite_start'; suite: string; timestamp: number }
  | { type: 'case_start'; suite: string; name: string; timestamp: number }
  | { type: 'case_pass'; suite: string; name: string; duration: number; timestamp: number;
      attempts?: AttemptResult[] }
  | { type: 'case_fail'; suite: string; name: string; error: string; duration: number;
      timestamp: number; diagnostics?: DiagnosticReport; attempts?: AttemptResult[];
      request?: { method: string; url: string; headers: Record<string, string>; body?: unknown };
      response?: { status: number; headers: Record<string, string>; body?: unknown };
      assertions?: AssertionResult[] }
  | { type: 'case_skip'; suite: string; name: string; reason?: string; timestamp: number }
  | { type: 'suite_end'; suite: string; passed: number; failed: number; skipped: number; duration: number; timestamp: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; timestamp: number };

// ==================== 断言 ====================

export interface AssertionResult {
  path: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}

// ==================== 测试运行器 ====================

export interface RunConfig {
  cwd: string;
  target: string;
  env: Record<string, string>;
  timeout: number;
}

export interface TestRunner {
  id: string;
  run(config: RunConfig): AsyncGenerator<TestEvent>;
  available(): Promise<boolean>;
}

// ==================== Docker ====================

export type BuildEvent =
  | { type: 'build_start'; image: string; timestamp: number }
  | { type: 'build_log'; line: string; stream: 'stdout' | 'stderr'; timestamp: number }
  | { type: 'build_end'; success: boolean; duration: number; error?: string; timestamp: number };

export type ContainerStatus = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead' | 'unknown';

export type ContainerEvent =
  | { type: 'container_start'; name: string; timestamp: number }
  | { type: 'container_healthy'; name: string; timestamp: number }
  | { type: 'container_stop'; name: string; timestamp: number }
  | { type: 'container_log'; name: string; line: string; stream: 'stdout' | 'stderr'; timestamp: number }
  | { type: 'container_error'; name: string; error: string; timestamp: number };

// ==================== Setup/Clean 生命周期事件 ====================

export type SetupEvent =
  | { type: 'setup_start'; project: string; timestamp: number }
  | { type: 'network_created'; name: string; timestamp: number }
  | { type: 'mock_starting'; name: string; port: number; timestamp: number }
  | { type: 'mock_started'; name: string; port: number; timestamp: number }
  | { type: 'mock_openapi_parsed'; name: string; endpoints: number; specVersion: string; timestamp: number }
  | { type: 'mock_validation_error'; name: string; method: string; path: string; errors: unknown[]; timestamp: number }
  | { type: 'mock_recording_saved'; name: string; method: string; path: string; timestamp: number }
  | { type: 'service_starting'; name: string; image: string; timestamp: number }
  | { type: 'service_healthy'; name: string; duration: number; timestamp: number }
  | { type: 'setup_end'; duration: number; success: boolean; error?: string; timestamp: number };

export type CleanEvent =
  | { type: 'clean_start'; project: string; timestamp: number }
  | { type: 'container_removing'; name: string; timestamp: number }
  | { type: 'container_removed'; name: string; timestamp: number }
  | { type: 'mock_stopped'; name: string; timestamp: number }
  | { type: 'network_removed'; name: string; timestamp: number }
  | { type: 'clean_end'; duration: number; timestamp: number };

// ==================== Resilience SSE Events ====================

export type ResilienceEvent =
  | { type: 'preflight_start'; project: string; timestamp: number }
  | { type: 'preflight_check'; name: string; status: string; message: string; timestamp: number }
  | { type: 'preflight_end'; overall: string; duration: number; timestamp: number }
  | { type: 'restart_attempt'; container: string; attempt: number; reason: string; delay: number; timestamp: number }
  | { type: 'restart_success'; container: string; attempt: number; duration: number; timestamp: number }
  | { type: 'restart_exhausted'; container: string; attempts: number; timestamp: number }
  | { type: 'cleanup_start'; project: string; timestamp: number }
  | { type: 'cleanup_resource'; resourceType: string; name: string; action: string; timestamp: number }
  | { type: 'cleanup_end'; found: number; removed: number; failed: number; timestamp: number }
  | { type: 'port_conflict'; service: string; port: number; pid?: number; timestamp: number }
  | { type: 'port_reassigned'; service: string; original: number; actual: number; timestamp: number }
  | { type: 'circuit_open'; failureCount: number; lastError: string; timestamp: number }
  | { type: 'circuit_half_open'; timestamp: number }
  | { type: 'circuit_closed'; probeSucceeded: boolean; timestamp: number }
  | { type: 'network_check'; service: string; reachable: boolean; timestamp: number }
  | { type: 'network_verified'; allReachable: boolean; timestamp: number };

/** Unified event type spanning all lifecycle phases. */
export type PreflightEvent = TestEvent | BuildEvent | ContainerEvent | SetupEvent | CleanEvent | ResilienceEvent;

/** Preflight event channels for the SSE bus. */
export type PreflightChannel = 'test' | 'build' | 'container' | 'setup' | 'clean' | 'activity' | 'resilience';

/** Entry in the activity timeline — tracks a single high-level operation. */
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

// ==================== SSE ====================

export interface SSEMessage {
  event: string;
  data: unknown;
}

export interface SSEBus {
  emit(channel: string, message: SSEMessage): void;
  subscribe(channel: string, handler: (msg: SSEMessage) => void): () => void;
}

// ==================== Reporter ====================

export interface SuiteReport {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  cases: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
    attempts?: AttemptResult[];
    diagnostics?: DiagnosticReport;
  }>;
}

export interface TestReport {
  project: string;
  timestamp: number;
  duration: number;
  suites: SuiteReport[];
  totals: { passed: number; failed: number; skipped: number };
}

export interface Reporter {
  id: string;
  onEvent(event: TestEvent): void;
  generate(): TestReport;
}

// ==================== 变量上下文 ====================

export interface VariableContext {
  /** 从配置获取的变量 */
  config: Record<string, string>;
  /** 运行时变量（save 保存的） */
  runtime: Record<string, string>;
  /** 环境变量 */
  env: Record<string, string>;
}
