# argusai-mcp

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
