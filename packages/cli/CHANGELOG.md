# argusai

## 0.12.3

### Patch Changes

- Updated dependencies
  - argusai-core@0.12.3
  - argusai-mcp@0.12.3
  - argusai-dashboard@0.12.3

## 0.12.2

### Patch Changes

- Updated dependencies [e3744c1]
  - argusai-core@0.12.2
  - argusai-mcp@0.12.2
  - argusai-dashboard@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [7929fb6]
  - argusai-core@0.12.1
  - argusai-dashboard@0.12.1
  - argusai-mcp@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.12.0
  - argusai-dashboard@0.12.0
  - argusai-mcp@0.12.0

## 0.11.0

### Patch Changes

- Add plugin loading support via `e2e.yaml` `plugins` field.

  - **argusai-core**: New `plugin-loader.ts` with `loadPlugins()` / `teardownPlugins()` functions. New `PluginModule` interface exported from package root. `E2EConfig` and `E2EConfigSchema` gain optional `plugins: string[]` field.
  - **argusai-cli**: `argusai run` loads plugins declared in `plugins[]` before executing suites and calls teardown after all suites finish.
  - **argusai-mcp**: `argus_init` loads plugins on session initialization; plugin errors surface as `PLUGIN_LOAD_ERROR` session errors.

- Updated dependencies
  - argusai-core@0.11.0
  - argusai-mcp@0.11.0
  - argusai-dashboard@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.10.0
  - argusai-mcp@0.10.0
  - argusai-dashboard@0.10.0

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
  - argusai-mcp@0.9.0
  - argusai-dashboard@0.9.0

## 0.7.0

### Patch Changes

- Updated dependencies
  - argusai-mcp@0.7.0

## 0.6.0

### Minor Changes

- feat: 集成所有 0.6.0 新功能

  - 测试结果持久化与趋势分析
  - 智能诊断建议与修复知识库
  - OpenAPI 智能 Mock
  - 多项目隔离
  - YAML 浏览器测试 DSL

### Patch Changes

- Updated dependencies
  - argusai-core@0.6.0
  - argusai-mcp@0.6.0
  - argusai-dashboard@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies
  - argusai-core@0.5.2
  - argusai-mcp@0.5.2
  - argusai-dashboard@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies
  - argusai-core@0.5.1
  - argusai-mcp@0.5.1
  - argusai-dashboard@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies
  - argusai-core@0.2.0
  - argusai-mcp@0.2.0
  - argusai-dashboard@0.2.0
