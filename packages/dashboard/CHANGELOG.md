# argusai-dashboard

## 0.15.4

### Patch Changes

- 9a8aa8c: Fix Docker-mode e2e: resolve namespace-prefixed container names in steps

  0.15.x prefixes containers with the isolation namespace (`wt-XXX-recursive-e2e`)
  but exec/file/process/port steps still used the raw YAML name
  (`recursive-e2e`), so `docker exec recursive-e2e` failed with
  "No such container" whenever WORKTREE_ID was set.

  - `executeExecStep` / `executeFileStep` / `executeProcessStep` /
    `executePortStep`: the session-resolved `containerName` (injected via
    options) now takes priority over the raw `step.container` — mirrors the
    container naming change. HostRuntime ignores the name, so host mode is
    unaffected.
  - Plugin steps (e.g. `recursive-session`'s docker cp): the step body's
    `container` field is overridden with the resolved name before dispatch,
    so container-side assertions reach the right container.

  Verified: Docker-mode e2e suites pass again (smoke/basic/session/memory/
  cost/export/http-api/http-auth/http-interrupt/http-rate-limit/goal-loop/
  bash-tool/glob-tool/utility-tools/sandbox-security/session-rewind/
  compaction/python-sdk/typescript-sdk — 20 suites); host mode stays 39/41.

- Updated dependencies [9a8aa8c]
  - argusai-core@0.15.4

## 0.15.3

### Patch Changes

- e6412aa: HostRuntime: run exec commands with cwd = workspaceDir (mirror Docker WORKDIR)

  HostRuntime.execInContainer now sets `cwd: workspaceDir` when a workspace
  dir is configured. Without this, host-mode processes inherited the
  daemon's cwd, so commands relying on relative paths — or binaries that
  default their workspace to cwd (e.g. `recursive http` with no
  `--workspace`) — resolved files outside the mapped workspace, diverging
  from Docker mode (where `docker exec` uses the image WORKDIR=/workspace).

  Fixes recursive's host-mode e2e suites where the agent wrote files to
  the daemon cwd instead of the workspace (e.g. 08-http-api's
  "POST /run wrote http-run.txt" assertion).

- Updated dependencies [e6412aa]
  - argusai-core@0.15.3

## 0.15.2

### Patch Changes

- Updated dependencies
  - argusai-core@0.15.2

## 0.15.1

### Patch Changes

- Updated dependencies
  - argusai-core@0.15.1

## 0.15.0

### Patch Changes

- b9df8c4: HostRuntime: run e2e suites on the host without Docker containers

  New `runtime: { type: host }` config option that executes test commands
  directly on the host machine — no Docker image builds, no service containers,
  no Docker networks. Test commands (exec/file/process/port steps) route through
  a `HostRuntime` that ignores container names and runs via `sh -c` on the host.

  **Breaking change (interface):** `ContainerRuntime.execInContainer` now returns
  `RuntimeExecResult { stdout, exitCode }` instead of `Promise<string>`. This
  type was already declared but unused; the upgrade surfaces the exitCode that
  yaml-engine needs for `expect.exitCode` assertions. `DockerRuntime`,
  `KubernetesRuntime`, and `HostRuntime` all implement the new signature.

  **Key changes:**

  - `runtime.ts`: new `HostRuntime` class; `RuntimeType` adds `'host'`;
    `createRuntime({ type: 'host' })` returns it. Container lifecycle methods
    (build/start/network/health) are no-ops in host mode.
  - `yaml-engine.ts`: `YAMLEngineOptions` gains optional `runtime`; when injected,
    exec/file/process/port steps route through `runtime.execInContainer` instead
    of hardcoded `docker exec`. Legacy fallback preserved (no runtime = docker).
  - `docker-engine.ts`: `execInContainer` returns `{ stdout, exitCode }` instead
    of throwing on non-zero exit (callers decide handling).
  - `config-loader.ts`: `runtime` field added to zod schema (was being stripped).
  - `types.ts`: `E2EConfig.runtime` added; `ServiceConfig.build` and
    `ServiceDefinition.build` become optional (host mode builds no image).
  - `session.ts`: session holds a `ContainerRuntime` instance from `createRuntime`.
  - `run.ts`: injects `session.runtime` into `executeYAMLSuite`.
  - `setup.ts`: host-mode services (no build config) skip container startup.
  - `index.ts` (mcp): `isMainModule` detection is now symlink-aware (realpathSync)
    so `npm link` works for local development.
  - `index.ts` (core): `HostRuntime` re-exported for consumers.

  Fulfills the F08 TODO in setup.ts (wire ContainerRuntime through the execution
  path instead of bypassing it with direct docker-engine calls).

- Updated dependencies [b9df8c4]
  - argusai-core@0.15.0

## 0.14.3

### Patch Changes

- Updated dependencies [2eb6b59]
  - argusai-core@0.14.3

## 0.14.2

### Patch Changes

- Updated dependencies [442e362]
  - argusai-core@0.14.2

## 0.14.1

### Patch Changes

- Updated dependencies [bca4ec3]
  - argusai-core@0.14.1

## 0.14.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.14.0

## 0.12.3

### Patch Changes

- Updated dependencies
  - argusai-core@0.12.3

## 0.12.2

### Patch Changes

- Updated dependencies [e3744c1]
  - argusai-core@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [7929fb6]
  - argusai-core@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.11.0

## 0.10.0

### Minor Changes

- ## ArgusAI Server Platformization (v0.10.0)

  ### New Features

  **argusai-core**:

  - Drizzle ORM database abstraction layer (`packages/core/src/db/`) with SQLite/PG/MySQL schema support
  - Server sync infrastructure (`packages/core/src/sync/`): SyncQueue, SyncClient, SyncManager, RemoteHistoryStore
  - `ServerConfig` type and `ServerConfigSchema` for `e2e.yaml` `server` section
  - `AssertionPluginRegistry` + `globalAssertionPluginRegistry` for pluggable custom assertions
  - `assertFile*` and `judgeLlm` promoted to core assertion engine (generic, not agent-specific)
  - DB migration v3: `sync_queue` table, server columns on `test_runs`/`failure_patterns`

  **argusai-mcp**:

  - Session manager migrated to `DrizzleHistoryStore` and `DrizzleKnowledgeStore`

  **argusai-dashboard**:

  - Server-aware UI components: `LoginScreen`, `ProjectList`, `TeamSelector`
  - `DataSourceContext` for local ↔ remote data source switching
  - API client for Dashboard ↔ ArgusAI Server REST integration

  ### Deprecations

  - `agent-assertions/session-assertions`, `cost-assertions`, `AgentTestRunner` are deprecated.
    Implement as `AssertionPlugin` instances registered with `AssertionPluginRegistry` instead.

  ### New Package

  **argusai-server** (v0.6.0 → v0.7.0, published separately — not in linked group):

  - Fastify REST API server for centralized test result aggregation
  - Multi-tenant team isolation, WeChat Work notifications, trend analytics
  - Docker deployment support

### Patch Changes

- Updated dependencies
  - argusai-core@0.10.0

## 0.9.0

### Minor Changes

- c73ba7e: feat: HTML 报告、历史持久化、ignoreError 支持

  ### CLI (`argusai-cli`)

  - `argusai run --reporter html --output <path>` — 生成自包含 HTML 测试报告
  - `argusai run --no-history` — 跳过历史记录写入
  - 运行结果自动持久化到 HistoryStore（需 history.enabled 配置）

  ### Core (`argusai-core`)

  - 新增 `HTMLReporter`，支持生成美观的自包含 HTML 报告（折叠错误详情、进度条、中文时间格式）
  - YAML 引擎支持 `ignoreError: true` — 测试用例失败时标记为通过（用于 teardown 清理等场景）
  - Playwright runner 支持 `--config` 选项传递
  - `ConsoleReporter` 改进：运行中实时输出 + 运行结束汇总

  ### Dashboard (`argusai-dashboard`)

  - 新增 Overview 页面（总览统计）
  - 新增 Environment 页面（环境变量查看）
  - API Explorer 增强（YAML + OpenAPI spec 浏览）
  - Run History 集成（Dashboard 内查看运行记录）

### Patch Changes

- Updated dependencies [c73ba7e]
  - argusai-core@0.9.0

## 0.6.0

### Minor Changes

- feat: 新增趋势分析页面与历史 REST API

  **Dashboard 趋势分析页面：**

  - 通过率折线图（PassRateChart）
  - 执行时间区域图（DurationChart）
  - Flaky Test 排行表（FlakyTable）
  - 最近失败列表（FailuresList）
  - 运行历史时间轴（RunTimeline）
  - 日期范围和 Suite 过滤器

  **REST API 端点 (7 个)：**

  - `GET /api/trends/pass-rate` — 通过率趋势
  - `GET /api/trends/duration` — 执行时间趋势
  - `GET /api/trends/flaky` — Flaky 排行榜
  - `GET /api/trends/failures` — 用例失败趋势
  - `GET /api/runs` — 运行历史列表
  - `GET /api/runs/:id` — 单次运行详情
  - `GET /api/runs/:id/compare/:compareId` — 运行对比

### Patch Changes

- Updated dependencies
  - argusai-core@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies
  - argusai-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies
  - argusai-core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.2.0
