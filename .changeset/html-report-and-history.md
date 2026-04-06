---
"argusai-core": minor
"argusai-cli": minor
"argusai-mcp": minor
"argusai-dashboard": minor
---

feat: HTML 报告、历史持久化、ignoreError 支持

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
