# argusai-core

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
