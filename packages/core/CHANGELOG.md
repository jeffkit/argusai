# argusai-core

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
  - argusai-core-storage@0.15.4

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
  - argusai-core-storage@0.15.3

## 0.15.2

### Patch Changes

- HostRuntime: map aimock:PORT → localhost:PORT + generic E2E_HOST_REPLACEMENTS

  HostRuntime's execInContainer now also rewrites Docker network DNS names to
  localhost: `aimock:4010` → `localhost:4010`. This lets YAML suites with
  hardcoded `http://aimock:PORT` URLs run on the host unchanged.

  Also adds a generic `E2E_HOST_REPLACEMENTS` env var for custom replacements
  (space-separated `old=new` pairs) when additional Docker→host mappings are
  needed.

## 0.15.1

### Patch Changes

- HostRuntime: transparent /workspace path mapping

  HostRuntime now accepts an optional workspaceDir (via config
  `runtime.host.workspaceDir` or `E2E_WORKSPACE_DIR` env var). When set,
  `/workspace` in exec commands is transparently rewritten to the
  configured directory, so YAML suites that hardcode `/workspace/...`
  (a container path) run on the host unchanged. This avoids editing 33+
  YAML files for host-mode compatibility.

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
  - argusai-core-storage@0.15.0

## 0.14.3

### Patch Changes

- 2eb6b59: fix(isolation): complete concurrent-run isolation — namespace container names, add labels, support random host ports (issue #9)

  - Container names are now prefixed with the isolation namespace (`<namespace>-<name>`, `deriveNamespace` enabled), keeping the original name as a `--network-alias` so in-network DNS (e.g. `http://aimock:4010`) is unchanged. Applies to service containers and image-based mocks.
  - All resources created by `argus_setup` (network + containers) now carry `argusai.managed` / `argusai.project` / `argusai.run-id` / `argusai.created-at` labels, so `OrphanCleaner`, `argus_resources` and `argus_clean` work on the MCP path.
  - `ports: ["0:8080"]` is now supported: Docker assigns a random host port and `argus_setup` reads it back (`getHostPort`) into the session; `argus_run` base URL and `argus_status` report the effective host port, so tests no longer hit silently-reassigned ports.

## 0.14.2

### Patch Changes

- 442e362: fix(run): attribute suite events by id to prevent silent false-green (issue #8)

  - Stamp `suiteId` from e2e.yaml onto all YAML suite/case events
  - Aggregate `argus_run` results by `suiteId` instead of free-text `name`
  - Guard: if a suite declares cases but none are attributed, mark failed (never empty pass)

## 0.14.1

### Patch Changes

- bca4ec3: fix run UX and output.length assertion (issues #5, #6, #7)

  - **#7**: `expect.output.length` now supports number (`1`), string (`">0"`), and object (`{ gte: 1 }` / `{ eq: 1 }`) without throwing `match is not a function`
  - **#5**: `argus_run` / `argus_run_suite` auto-start missing service/mock containers via setup instead of per-case "No such container" failures
  - **#6**: failed runs return `exitCode: 1` and MCP `isError: true` for CI-friendly failure detection

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
  - argusai-core-storage@0.14.0

## 0.12.3

### Patch Changes

- Improve MCP session robustness, converge the SQLite storage layer, and refactor Docker event streaming.

  - mcp: read-only/persistence-backed tools (history, trends, flaky, compare, diagnose, patterns, report-fix) now lazily load `e2e.yaml` via `SessionManager.ensure()` instead of failing with `SESSION_NOT_FOUND` after a process restart, TTL expiry, or when `argus_init` was never called. `argus_init` transparently re-initializes such lazily-created sessions.
  - mcp: knowledge base now keys off the shared raw DB handle, so it stays enabled even when the history store is wrapped (e.g. `RemoteHistoryStore`).
  - core: `SQLiteHistoryStore` now owns only the connection/migrations and delegates all queries to an internal `DrizzleHistoryStore`, removing duplicated SQL so Drizzle is the single source of query truth.
  - core: replaced the Docker build/log async-generator event bridge (shared array + 1s polling) with a promise-based queue, eliminating up-to-1s event latency and busy-waiting.

## 0.12.2

### Patch Changes

- e3744c1: feat(mcp): support image-based mocks as Docker containers in argus-setup

  - `MockServiceConfig` gains `volumes` and `args` fields (types.ts, config-loader.ts)
  - `argus-setup` MCP tool now starts image-based mocks (e.g. aimock) as Docker
    containers joined to the session's isolation network, instead of skipping them
  - Volume paths relative to projectPath are resolved to absolute paths before
    passing to `docker run`, so `./fixtures:/fixtures` works correctly
  - Stale containers with the same name are removed before starting fresh

## 0.12.1

### Patch Changes

- 7929fb6: **fix(yaml-engine): emit `case_skip` for remaining cases when a case fails in `sequential: true` suites (fail-fast)**

  Previously, when a YAML test suite was declared with `sequential: true` and a case failed, the engine would still run every subsequent case. This often produced misleading reports — a single root cause (e.g. a broken setup or a regression in case 2) could surface as N independent failures because cases 3..N typically depend on case 2's side effects.

  The engine now short-circuits: once a case fails (after retries are exhausted, and not via `ignoreError`) in a `sequential: true` suite, every remaining case is reported via the existing `case_skip` event with reason `"Previous case failed in sequential suite (fail-fast)"`. The `case_skip` event type was already defined in `types.ts` and aggregated by `reporter.ts` (`suite.skipped++`), so no downstream change is required — dashboards, CLI, and HTML reports keep working.

  **Backward compatibility:**

  - Suites without `sequential: true` (or `sequential: false` / unset) keep the existing "run every case" behavior.
  - `ignoreError: true` cases are unaffected — they still produce `case_pass` and never trigger fail-fast.
  - Retried cases that eventually pass are unaffected — only post-exhaustion failures trigger fail-fast.
  - `setup` / `teardown` failure semantics are unchanged.

  Adds 7 new unit tests in `tests/unit/yaml-engine.test.ts` covering: sequential+fail (skips remaining), all-pass (no skip), undefined / explicit-false (no skip), `ignoreError` (no skip), retry-then-pass (no skip), and retry-exhausted-with-sequential (skip after retry exhaustion).

## 0.12.0

### Minor Changes

- feat(yaml-engine): add plugin step fallback in executeStep

  The YAML engine now falls back to the global AssertionPluginRegistry when a
  step contains an unrecognized top-level field. If a registered plugin handles
  the field name (via `AssertionPluginRegistry.handles()`), the engine calls
  `globalAssertionPluginRegistry.runAll(key, value, step.expect)` and returns
  the failed assertion messages instead of the generic "no recognized step type"
  error.

  This closes the two gaps identified in the plugin integration:

  1. `executeStep` now has a plugin registry fallback branch.
  2. `globalAssertionPluginRegistry.runAll()` is now exercised in the YAML
     execution path.

  Custom step types (e.g. `recursive-session:`) registered by external plugins
  via `PluginModule.assertionPlugins` are now fully supported in YAML test files.

## 0.11.0

### Minor Changes

- Add plugin loading support via `e2e.yaml` `plugins` field.

  - **argusai-core**: New `plugin-loader.ts` with `loadPlugins()` / `teardownPlugins()` functions. New `PluginModule` interface exported from package root. `E2EConfig` and `E2EConfigSchema` gain optional `plugins: string[]` field.
  - **argusai-cli**: `argusai run` loads plugins declared in `plugins[]` before executing suites and calls teardown after all suites finish.
  - **argusai-mcp**: `argus_init` loads plugins on session initialization; plugin errors surface as `PLUGIN_LOAD_ERROR` session errors.

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

## 0.6.0

### Minor Changes

- feat: YAML 浏览器测试 DSL — 声明式 Playwright 集成

  在 YAML 测试引擎中新增 `browser` 步骤类型，无需编写 TypeScript 代码即可完成浏览器 E2E 测试。

  - 新增 `BrowserSession` 类封装 Playwright 生命周期管理
  - 支持 18 种声明式浏览器操作：goto、click、fill、type、press、select、check、uncheck、hover、focus、clear、waitForSelector、waitForURL、waitForLoadState、screenshot、evaluate、setLocalStorage、scrollTo
  - 页面级断言：url、title、visible、hidden、text、inputValue、count、result
  - 变量保存：page.url、page.title、result、text:\<selector\>、value:\<selector\>、count:\<selector\>
  - Playwright 作为可选 peerDependency，按需动态加载

- feat: 测试结果持久化与趋势分析 (004-history)

  - SQLite 持久化引擎（WAL 模式），自动记录每次测试运行和用例级别结果
  - Flaky Test 识别引擎：基于滑动窗口的 5 级稳定性分级（STABLE → BROKEN）
  - 4 个新 MCP 工具：argus_history、argus_trends、argus_flaky、argus_compare (11→15 tools)
  - Dashboard 趋势分析页面：通过率折线图、执行时间图、Flaky 排行榜、运行时间轴
  - REST API 趋势端点：pass-rate、duration、flaky、failures、runs
  - 可配置存储模式（local/memory）和保留策略

- feat: 智能诊断建议 (005-diagnostics)

  - 10 分类规则链自动将失败分类为结构化类别
  - 确定性失败签名生成（8 步错误规范化 + SHA-256）
  - 修复知识库：6 个内置模式 + 自学习模式
  - 修复反馈闭环：Agent 报告修复后自动更新置信度
  - 3 个新 MCP 工具：argus_diagnose、argus_report_fix、argus_patterns (15→18 tools)

- feat: OpenAPI 智能 Mock (006-openapi-mock)

  - 从 OpenAPI 3.x spec 一键生成 Mock 路由（零手动定义）
  - 请求验证模式：自动检测请求格式错误并返回 422
  - 手动覆盖优先级：override 路由覆盖自动生成路由
  - 录制/回放模式：record、replay、smart、auto 四种模式
  - 2 个新 MCP 工具：argus_mock_generate、argus_mock_validate (18→20 tools)

- feat: 多项目隔离 (⑦-L1)

  - Docker 资源命名空间隔离（容器、网络按 project 标记）
  - 端口注册表避免跨项目端口冲突
  - argus_resources MCP 工具查看所有项目资源 (20→21 tools)

### Patch Changes

- MCP 工具总数从 9 个增长至 22 个（含 argus_rebuild）

## 0.5.2

### Patch Changes

- fix: resolve workspace protocol in npm publish

  Fix CI publishing pipeline — switch from `npm publish` to `pnpm publish`
  so that `workspace:*` references are automatically resolved to actual
  version numbers before uploading to the registry.

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

## 0.5.0

### Minor Changes

- feat: add Error Recovery & Self-Healing resilience subsystem

  - 7 resilience modules: error-codes, preflight, container-guardian, port-resolver, orphan-cleaner, circuit-breaker, network-verifier
  - 13 structured error codes for AI-parseable diagnostics
  - 2 new MCP tools: argus_preflight_check, argus_reset_circuit (9→11 tools)
  - Resilience config section in e2e.yaml schema
  - 141 unit tests across 15 test files
