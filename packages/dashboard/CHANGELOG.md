# argusai-dashboard

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
