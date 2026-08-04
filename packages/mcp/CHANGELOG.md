# argusai-mcp

## 0.15.2

### Patch Changes

- HostRuntime: map aimock:PORT → localhost:PORT + generic E2E_HOST_REPLACEMENTS

  HostRuntime's execInContainer now also rewrites Docker network DNS names to
  localhost: `aimock:4010` → `localhost:4010`. This lets YAML suites with
  hardcoded `http://aimock:PORT` URLs run on the host unchanged.

  Also adds a generic `E2E_HOST_REPLACEMENTS` env var for custom replacements
  (space-separated `old=new` pairs) when additional Docker→host mappings are
  needed.

- Updated dependencies
  - argusai-core@0.15.2

## 0.15.1

### Patch Changes

- HostRuntime: transparent /workspace path mapping

  HostRuntime now accepts an optional workspaceDir (via config
  `runtime.host.workspaceDir` or `E2E_WORKSPACE_DIR` env var). When set,
  `/workspace` in exec commands is transparently rewritten to the
  configured directory, so YAML suites that hardcode `/workspace/...`
  (a container path) run on the host unchanged. This avoids editing 33+
  YAML files for host-mode compatibility.

- Updated dependencies
  - argusai-core@0.15.1

## 0.15.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b9df8c4]
  - argusai-core@0.15.0

## 0.14.3

### Patch Changes

- 2eb6b59: fix(isolation): complete concurrent-run isolation — namespace container names, add labels, support random host ports (issue #9)

  - Container names are now prefixed with the isolation namespace (`<namespace>-<name>`, `deriveNamespace` enabled), keeping the original name as a `--network-alias` so in-network DNS (e.g. `http://aimock:4010`) is unchanged. Applies to service containers and image-based mocks.
  - All resources created by `argus_setup` (network + containers) now carry `argusai.managed` / `argusai.project` / `argusai.run-id` / `argusai.created-at` labels, so `OrphanCleaner`, `argus_resources` and `argus_clean` work on the MCP path.
  - `ports: ["0:8080"]` is now supported: Docker assigns a random host port and `argus_setup` reads it back (`getHostPort`) into the session; `argus_run` base URL and `argus_status` report the effective host port, so tests no longer hit silently-reassigned ports.

- Updated dependencies [2eb6b59]
  - argusai-core@0.14.3

## 0.14.2

### Patch Changes

- 442e362: fix(run): attribute suite events by id to prevent silent false-green (issue #8)

  - Stamp `suiteId` from e2e.yaml onto all YAML suite/case events
  - Aggregate `argus_run` results by `suiteId` instead of free-text `name`
  - Guard: if a suite declares cases but none are attributed, mark failed (never empty pass)

- Updated dependencies [442e362]
  - argusai-core@0.14.2

## 0.14.1

### Patch Changes

- bca4ec3: fix run UX and output.length assertion (issues #5, #6, #7)

  - **#7**: `expect.output.length` now supports number (`1`), string (`">0"`), and object (`{ gte: 1 }` / `{ eq: 1 }`) without throwing `match is not a function`
  - **#5**: `argus_run` / `argus_run_suite` auto-start missing service/mock containers via setup instead of per-case "No such container" failures
  - **#6**: failed runs return `exitCode: 1` and MCP `isError: true` for CI-friendly failure detection

- Updated dependencies [bca4ec3]
  - argusai-core@0.14.1

## 0.14.0

### Minor Changes

- ## v0.13.0 — Storage extraction, async mutex, AI UX fixes

  ### New Package: `argusai-core-storage`

  Extracted the history/knowledge/db/sync storage layer from `argusai-core` into a dedicated
  `argusai-core-storage` package using the Strangler Fig pattern. `argusai-core` re-exports
  everything for full backward compatibility — no consumer changes required.

  ### Breaking / Structural Changes (argusai-mcp)

  - **Async session mutex**: replaced the synchronous fake-lock `SessionMutex` with a true async
    `AsyncSessionMutex` using `async-mutex`. Concurrent tool calls on the same project are now
    correctly serialised across `await` boundaries. The old `acquireLock`/`releaseLock` pair is
    replaced by the safer `withLock(key, fn)` API.
  - **runId collision fix**: `runId` now uses `randomUUID()` instead of `Date.now().toString(36)`,
    eliminating collision risk under high-concurrency or fast-clock environments.

  ### Bug Fixes

  - **Suite duration was always ~0ms**: YAML suite duration is now read from the engine-emitted
    `suite_end.duration` field instead of being measured after all events are collected.
  - **Registry re-created per external suite**: `RunnerRegistry` is now created once outside the
    loop instead of once per external suite (vitest/pytest/playwright/etc.).
  - **Removed dangerous `cwd()` fallback**: `resolveProjectPath` no longer falls back to
    `process.cwd()`, which caused silent test failures when MCP was invoked from a different
    working directory than the project root.

  ### AI UX Improvements

  - **`sessionState` in every response**: all lifecycle tools (init/build/setup/run/run_suite/
    status/logs/clean/rebuild/dev) now include a `sessionState` field (`"initialized"` |
    `"built"` | `"running"` | `"stopped"` | `"none"`) so AI agents always know the current
    environment phase without an extra `argus_status` call.
  - **Output size control**: `argus_run` and `argus_run_suite` gain a `maxFailures` parameter
    (default 20) that limits failed test cases in the response to prevent context overflow.
    The full untruncated data is still persisted to history. A `truncated: true` flag and
    `totalFailedCases` count are included when clipping occurs.
  - **History write warnings**: history persistence failures are now surfaced as `warnings[]`
    in the response instead of being silently discarded, including actionable guidance for
    critical DB errors.

### Patch Changes

- Updated dependencies
  - argusai-core@0.14.0

## 0.12.3

### Patch Changes

- Improve MCP session robustness, converge the SQLite storage layer, and refactor Docker event streaming.

  - mcp: read-only/persistence-backed tools (history, trends, flaky, compare, diagnose, patterns, report-fix) now lazily load `e2e.yaml` via `SessionManager.ensure()` instead of failing with `SESSION_NOT_FOUND` after a process restart, TTL expiry, or when `argus_init` was never called. `argus_init` transparently re-initializes such lazily-created sessions.
  - mcp: knowledge base now keys off the shared raw DB handle, so it stays enabled even when the history store is wrapped (e.g. `RemoteHistoryStore`).
  - core: `SQLiteHistoryStore` now owns only the connection/migrations and delegates all queries to an internal `DrizzleHistoryStore`, removing duplicated SQL so Drizzle is the single source of query truth.
  - core: replaced the Docker build/log async-generator event bridge (shared array + 1s polling) with a promise-based queue, eliminating up-to-1s event latency and busy-waiting.

- Updated dependencies
  - argusai-core@0.12.3

## 0.12.2

### Patch Changes

- e3744c1: feat(mcp): support image-based mocks as Docker containers in argus-setup

  - `MockServiceConfig` gains `volumes` and `args` fields (types.ts, config-loader.ts)
  - `argus-setup` MCP tool now starts image-based mocks (e.g. aimock) as Docker
    containers joined to the session's isolation network, instead of skipping them
  - Volume paths relative to projectPath are resolved to absolute paths before
    passing to `docker run`, so `./fixtures:/fixtures` works correctly
  - Stale containers with the same name are removed before starting fresh

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

- Add plugin loading support via `e2e.yaml` `plugins` field.

  - **argusai-core**: New `plugin-loader.ts` with `loadPlugins()` / `teardownPlugins()` functions. New `PluginModule` interface exported from package root. `E2EConfig` and `E2EConfigSchema` gain optional `plugins: string[]` field.
  - **argusai-cli**: `argusai run` loads plugins declared in `plugins[]` before executing suites and calls teardown after all suites finish.
  - **argusai-mcp**: `argus_init` loads plugins on session initialization; plugin errors surface as `PLUGIN_LOAD_ERROR` session errors.

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

## 0.7.0

### Minor Changes

- Add argus_dev tool for one-step project startup for manual testing. Combines init + build + setup into a single command, returns developer-friendly access URLs, and reuses healthy existing sessions.

## 0.6.0

### Minor Changes

- feat: 新增 11 个 MCP 工具（11→22 tools）

  **测试持久化与趋势 (004-history):**

  - `argus_history` — 查询历史运行记录
  - `argus_trends` — 获取趋势数据（通过率/执行时间/flaky）
  - `argus_flaky` — Flaky Test 列表
  - `argus_compare` — 对比两次运行

  **智能诊断建议 (005-diagnostics):**

  - `argus_diagnose` — 智能失败诊断（分类 + 模式匹配 + 修复建议）
  - `argus_report_fix` — 回报修复结果到知识库
  - `argus_patterns` — 浏览失败模式知识库

  **OpenAPI 智能 Mock (006-openapi-mock):**

  - `argus_mock_generate` — 从 OpenAPI spec 生成 Mock 配置
  - `argus_mock_validate` — Mock 覆盖度检查

  **多项目隔离 (⑦-L1):**

  - `argus_resources` — 资源使用概览

  **YAML 浏览器测试 DSL:**

  - yaml-engine 自动检测 browser 步骤并懒初始化 Playwright 会话

### Patch Changes

- Updated dependencies
  - argusai-core@0.6.0

## 0.5.2

### Patch Changes

- fix: resolve workspace protocol in npm publish

  Fix CI publishing pipeline — switch from `npm publish` to `pnpm publish`
  so that `workspace:*` references are automatically resolved to actual
  version numbers before uploading to the registry.

- Updated dependencies
  - argusai-core@0.5.2

## 0.5.1

### Patch Changes

- fix: resolve 9 issues from E2E testing feedback

  Bug fixes:

  - Fix docker build path resolution — build paths now resolved to absolute paths relative to e2e.yaml
  - Fix healthcheck hardcoded port 80 — auto-detects container port, supports explicit `port` field
  - Add `useExisting` param to skip build when image already exists
  - Include build output logs in error messages on failure

  Design improvements:

  - Enable test-only mode (run tests without services in initialized state)
  - Support docker-compose style object format for `services` config
  - Clean residual containers by Docker label in argus_clean

  New features:

  - Add `argus_rebuild` tool for one-step clean → init → build → setup

- Updated dependencies
  - argusai-core@0.5.1

## 0.5.0

### Minor Changes

- feat: add Error Recovery & Self-Healing resilience subsystem

  - 7 resilience modules: error-codes, preflight, container-guardian, port-resolver, orphan-cleaner, circuit-breaker, network-verifier
  - 13 structured error codes for AI-parseable diagnostics
  - 2 new MCP tools: argus_preflight_check, argus_reset_circuit (9→11 tools)
  - Resilience config section in e2e.yaml schema
  - 141 unit tests across 15 test files

### Patch Changes

- Updated dependencies
  - argusai-core@0.2.0
