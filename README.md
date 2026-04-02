# ArgusAI

> 配置驱动的 Docker 容器端到端测试平台 — 代码的百眼守护者

ArgusAI 是一个声明式的 E2E 测试框架，通过 YAML 配置文件描述测试环境、Mock 服务和测试用例，自动完成 Docker 镜像构建、容器管理、Mock 服务启动和测试执行。同时提供 MCP Server，让 AI 编程助手可以直接执行 E2E 测试。

## 特性

- **YAML 驱动** — 声明式定义测试环境和用例，零脚本编写
- **Docker 原生** — 自动构建镜像、管理容器、配置网络和健康检查
- **Mock 服务** — 内置 Mock 服务器，通过配置快速模拟外部依赖
- **OpenAPI 智能 Mock** — 从 OpenAPI 3.0/3.1 spec 自动生成 Mock 路由，支持请求验证、录制/回放
- **多运行器** — 支持 YAML / Vitest / pytest / Shell / Exec / Playwright 等多种测试运行器
- **断言 DSL** — 丰富的断言语法，支持精确匹配、正则、类型检查、存在性验证等
- **变量系统** — 支持 `{{config.*}}`、`{{env.*}}`、`{{runtime.*}}` 模板变量
- **韧性自愈** — 结构化错误码、预检健康检查、容器自动重启、端口冲突规避、孤儿资源清理、熔断器保护
- **测试持久化与趋势分析** — SQLite 持久化测试结果，Flaky Test 识别，通过率/时长趋势分析
- **智能诊断建议** — 失败自动分类、错误签名匹配、修复知识库、置信度评分、修复反馈闭环
- **可视化 Dashboard** — 实时查看测试执行状态、容器日志、Mock 请求录制、趋势分析
- **多项目隔离** — 进程级端口注册中心（`PortAllocator`）+ 项目命名空间网络（`argusai-<project>-network`），多项目并发运行互不干扰
- **纯测试模式** — 无需定义任何 `service`，直接对外部容器（如 docker-compose 编排的服务）跑 YAML 测试套件
- **完整 CLI** — 25 个命令覆盖测试全生命周期（构建、运行、诊断、趋势分析），适合终端和 AI Agent
- **MCP Server** — AI 原生集成，让 Cursor/Claude 等编程助手直接运行 E2E 测试（23 个工具）
- **CI/CD 模板** — 提供 GitLab CI 和 GitHub Actions 开箱即用模板

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 20.0 | 运行时环境 |
| pnpm | >= 10.0 | 包管理器 |
| Docker | >= 24.0 | 容器引擎（需启动 Docker Daemon） |

## 快速开始

### 1. 安装

```bash
# 全局安装 CLI
npm install -g argusai

# 或作为开发依赖
pnpm add -D argusai argusai-core
```

### 2. 初始化项目

```bash
argusai init
```

自动生成：
- `e2e.yaml` — 主配置文件
- `tests/health.yaml` — 示例健康检查测试
- `.env.example` — 环境变量模板

### 3. 编辑配置

编辑 `e2e.yaml`，配置你的服务：

```yaml
version: "1"

project:
  name: my-app
  description: "我的应用 E2E 测试"

service:
  build:
    dockerfile: Dockerfile
    context: .
    image: my-app:e2e

  container:
    name: my-app-e2e
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: test
    healthcheck:
      path: /health
      interval: 5s
      timeout: 3s
      retries: 10
      startPeriod: 15s

  vars:
    base_url: http://localhost:8080

tests:
  suites:
    - name: 健康检查
      id: health
      file: tests/health.yaml
```

### 4. 编写测试

创建 `tests/health.yaml`：

```yaml
name: 健康检查
description: 验证服务健康状态

cases:
  - name: "GET /health 返回 200"
    request:
      method: GET
      path: /health
    expect:
      status: 200
      body:
        status: ok
```

### 5. 运行测试

```bash
argusai build          # 构建 Docker 镜像
argusai setup          # 启动测试环境（网络 + Mock + 容器）
argusai run            # 执行测试
argusai clean          # 清理资源
```

## CLI 命令参考

```
argusai [command] [options]

全局选项:
  -c, --config <path>    e2e.yaml 配置文件路径
  --verbose              详细输出模式
  -V, --version          显示版本号
  -h, --help             显示帮助信息
```

| 命令 | 说明 | 关键选项 |
|------|------|----------|
| `init` | 初始化项目模板 | `--dir <path>` 目标目录 |
| `build` | 构建 Docker 镜像 | `--no-cache` 禁用缓存 |
| `setup` | 启动测试环境 | `--skip-build` 跳过构建 |
| `run` | 运行测试套件 | `-s <id>` 指定套件, `--reporter json` 报告格式, `--timeout <ms>` 超时 |
| `status` | 查看容器/网络状态 | — |
| `logs` | 查看容器日志 | `-f` 实时跟踪, `-n <lines>` 行数, `--container <name>` 指定容器 |
| `dashboard` | 启动可视化面板 | `-p <port>` 端口 |
| `clean` | 清理测试资源 | `--all` 同时删除镜像和 volumes |
| `dev` | 一键启动开发环境 | `--skip-build` 跳过构建, `--no-cache` 禁用缓存 |
| `rebuild` | 一键重建（clean+build+setup） | `--no-cache` 禁用缓存 |
| `history` | 查看历史测试运行记录 | `-n <count>` 记录数, `--status` 过滤, `--days <n>` 天数 |
| `flaky` | 检测不稳定测试 | `-n <count>` Top N, `--min-score` 阈值, `-s <id>` 套件 |
| `trends` | 查看测试趋势 | `-m <metric>` 指标, `-d <days>` 天数, `-s <id>` 套件 |
| `compare` | 对比两次运行差异 | `--base <id>` 基准, `--target <id>` 对比 |
| `diagnose` | 诊断失败的测试用例 | `--run <id>` 运行 ID, `--case <name>` 用例名 |
| `report-fix` | 报告修复结果 | `--run <id>`, `--case <name>`, `--fix <desc>` |
| `patterns` | 浏览失败模式知识库 | `--category`, `--source`, `--sort` |
| `preflight` | 环境预检健康检查 | `--auto-fix` 自动修复, `--skip-disk`, `--skip-orphans` |
| `resources` | 查看所有 ArgusAI Docker 资源 | — |
| `mock-requests` | 查看 Mock 请求录制 | `--mock <name>`, `--clear` |
| `mock-generate` | 从 OpenAPI spec 生成 Mock | `--spec <path>`, `--name`, `--port` |
| `mock-validate` | 验证 Mock 覆盖度 | `--mock <name>`, `--spec <path>` |
| `reset-circuit` | 重置 Docker 熔断器 | — |

### 典型工作流

```bash
# 完整的一键测试流程
argusai build && argusai setup && argusai run && argusai clean

# 一键启动开发环境
argusai dev

# 一键重建测试环境
argusai rebuild

# 只运行指定套件
argusai run -s health

# 运行多个套件
argusai run -s health,api

# JSON 报告输出（适合 CI）
argusai run --reporter json > test-results.json

# 启动 Dashboard 后手动测试
argusai setup && argusai dashboard

# 查看历史记录和趋势
argusai history -n 10
argusai trends -m pass-rate -d 7
argusai flaky -n 5

# 诊断失败的测试
argusai diagnose --run <run-id> --case "用例名称"

# 环境预检
argusai preflight --auto-fix
```

## e2e.yaml 配置参考

```yaml
version: "1"

project:
  name: my-project                # 项目名称（必填）
  description: "项目描述"          # 项目描述（可选）

# ============ 单服务模式 ============
service:
  build:
    dockerfile: Dockerfile         # Dockerfile 路径（必填）
    context: "."                   # 构建上下文（默认 "."）
    image: my-app:e2e             # 镜像名称（必填）
    args:                          # 构建参数（可选）
      NODE_ENV: production

  container:
    name: my-app-e2e              # 容器名称（必填）
    ports:                         # 端口映射（host:container）
      - "8080:3000"
    environment:                   # 环境变量（可选，支持变量引用）
      NODE_ENV: production
      API_KEY: "{{env.API_KEY}}"
    volumes:                       # Volume 挂载（可选）
      - "data-vol:/app/data"
    healthcheck:                   # 健康检查（可选）
      path: /health
      interval: 10s
      timeout: 5s
      retries: 10
      startPeriod: 30s

  vars:                            # 自定义变量（通过 {{config.xxx}} 引用）
    base_url: http://localhost:8080

# ============ 多服务模式 ============
services:
  - name: api-server
    build: { ... }
    container: { ... }
  - name: worker
    build: { ... }
    container: { ... }

# ============ Mock 服务 ============
mocks:
  gateway:
    port: 9081                    # 宿主机端口
    containerPort: 8081           # 容器内端口（可选）
    routes:
      - method: GET
        path: /api/status
        response:
          status: 200
          body: { status: "ok" }

  # OpenAPI 智能 Mock（从 spec 自动生成路由）
  payment-api:
    port: 9082
    openapi: ./specs/payment.yaml # OpenAPI 3.0/3.1 spec 文件
    mode: auto                    # auto | record | replay | smart
    validate: true                # 请求验证（不符合 schema 返回 422）
    target: http://real-api:8080  # record 模式的目标地址
    overrides:                    # 手动覆盖自动生成的路由
      - method: POST
        path: /api/charge
        response:
          status: 200
          body: { charged: true }

# ============ 测试套件 ============
tests:
  suites:
    - name: 健康检查
      id: health
      file: tests/health.yaml
      runner: yaml                # 可选：yaml | vitest | pytest | shell | exec | playwright

# ============ Dashboard ============
dashboard:
  port: 9095                      # API 端口（默认 9095）
  uiPort: 9091                   # UI 端口（默认 9091）

# ============ Docker 网络（可选） ============
# 默认网络名：argusai-<project-slug>-network（项目隔离）
# 手动指定时覆盖默认值：
network:
  name: my-custom-network

# ============ 多项目隔离（可选） ============
isolation:
  namespace: my-project        # 自定义 Docker 资源前缀（默认从 project.name 推导）
  portRange: [9000, 9999]      # 端口自动分配范围（默认 [9000, 9999]）

# ============ 纯测试模式（可选） ============
# 不定义 service/services 时，ArgusAI 仅执行测试，跳过 Docker 构建/启动。
# 适用于对外部编排容器（如 docker-compose up）执行 YAML 测试的场景。
# 须同时禁用 preflight：
resilience:
  preflight:
    enabled: false

# ============ 测试持久化（可选） ============
history:
  enabled: true
  storage: local              # local | memory
  retention: 90d              # 保留天数
  flakyWindow: 10             # Flaky 检测滑动窗口大小

# ============ 韧性与自愈（可选） ============
resilience:
  preflight:                         # 预检健康检查
    enabled: true                    # 启用预检（默认 true）
    diskSpaceThreshold: "2GB"        # 最低磁盘空间阈值
    cleanOrphans: true               # 自动清理孤儿资源
  container:                         # 容器自动重启
    restartOnFailure: true           # 容器崩溃时自动重启
    maxRestarts: 3                   # 最大重启次数
    restartDelay: "2s"               # 重启基础延迟
    restartBackoff: exponential      # 退避策略: exponential | linear
  network:                           # 网络韧性
    portConflictStrategy: auto       # 端口冲突策略: auto | fail
    verifyConnectivity: true         # 启动后验证 Mock 可达性
  circuitBreaker:                    # 熔断器
    enabled: true                    # 启用熔断保护
    failureThreshold: 5              # 连续失败阈值
    resetTimeoutMs: 30000            # 重置超时（毫秒）
```

## YAML 测试语法

### 测试文件结构

```yaml
name: 测试套件名称                    # 必填
description: 套件描述                 # 可选
sequential: true                     # 顺序执行（默认 true）

variables:                           # 套件级变量
  game_id: "test-{{timestamp}}"

setup:                               # 前置步骤
  - waitHealthy: { timeout: 60s }    # 等待服务健康
  - delay: 3s                        # 等待指定时间
  - name: "前置请求"                  # 执行 HTTP 请求
    request:
      method: POST
      path: /api/init

teardown:                            # 后置清理
  - name: "清理数据"
    request:
      method: DELETE
      path: /api/cleanup
    ignoreError: true

cases:                               # 测试用例
  - name: "用例名称"
    delay: 2s                        # 执行前等待
    request:
      method: GET
      path: /api/resource
      headers:
        Authorization: "Bearer {{config.token}}"
      body:
        key: value
      timeout: 30s
    expect:
      status: 200
      headers:
        content-type: application/json
      body:
        data: expected_value
    save:                            # 保存响应值供后续用例使用
      my_id: "data.id"
```

### 变量系统

| 模板 | 来源 | 示例 |
|------|------|------|
| `{{config.xxx}}` | `service.vars` + `variables` | `{{config.base_url}}` |
| `{{env.xxx}}` | 环境变量 / `.env` 文件 | `{{env.API_KEY}}` |
| `{{runtime.xxx}}` | `save` 保存的值 | `{{runtime.my_id}}` |
| `{{timestamp}}` | 当前 ISO-8601 时间戳 | — |

### 断言 DSL

```yaml
expect:
  status: 200                        # 精确匹配
  status: [200, 201]                 # 多值匹配

  body:
    name: "hello"                    # 字符串精确匹配
    count: 42                        # 数字精确匹配
    active: true                     # 布尔精确匹配

    token: { exists: true }          # 存在性检查
    name: { type: string }           # 类型检查
    status: { in: [active, pending] }  # 枚举值

    count: { gt: 0, lte: 100 }      # 数值比较
    message: { contains: "success" } # 包含子串
    code: { matches: "^\\d+$" }      # 正则匹配
    items: { length: 5 }             # 长度检查

    token: $exists                   # 简写 DSL
    status: $regex:^ok$              # 简写正则

    user:                            # 嵌套对象断言
      profile:
        age: { gt: 18 }

  headers:
    content-type: application/json   # 大小写不敏感
    x-request-id: { exists: true }
```

### 时间格式

支持 `100ms`、`5s`、`2m`、`1h` 或纯数字（毫秒）。

## Mock 服务

### 基本用法

```yaml
mocks:
  api-gateway:
    port: 9081
    routes:
      - method: GET
        path: /api/users/:id
        response:
          status: 200
          body:
            id: "{{request.params.id}}"
            name: "User {{request.params.id}}"
```

### 响应模板变量

| 变量 | 说明 |
|------|------|
| `{{request.body.xxx}}` | 请求 body 中的字段 |
| `{{request.params.xxx}}` | 路由参数 |
| `{{request.query.xxx}}` | Query 参数 |
| `{{timestamp}}` | ISO-8601 时间戳 |
| `{{uuid}}` | 随机 UUID v4 |

### 高级功能

```yaml
routes:
  # 延迟响应（模拟慢接口）
  - method: POST
    path: /api/slow
    response:
      status: 200
      delay: "2s"
      body: { result: ok }

  # 条件匹配（根据请求内容返回不同响应）
  - method: POST
    path: /api/action
    when:
      body:
        type: "create"
    response:
      status: 201
      body: { created: true }

  - method: POST
    path: /api/action
    response:
      status: 200
      body: { default: true }
```

### 诊断端点

每个 Mock 服务自动提供：

| 端点 | 说明 |
|------|------|
| `GET /_mock/health` | Mock 服务健康检查 |
| `GET /_mock/requests` | 查看所有已录制的请求 |
| `POST /_mock/requests/clear` | 清空录制的请求 |

## 测试运行器

| 运行器 | runner ID | 用途 | 目标格式 |
|--------|-----------|------|----------|
| YAML Runner | `yaml` | 声明式 HTTP 测试（默认） | `.yaml` 测试文件 |
| Vitest Runner | `vitest` | JS/TS 单元/集成测试 | 测试目录/文件 |
| Pytest Runner | `pytest` | Python 测试 | 测试目录/文件 |
| Shell Runner | `shell` | Shell 脚本测试 | `.sh` 脚本 |
| Exec Runner | `exec` | 任意命令 | 命令字符串 |
| Playwright Runner | `playwright` | 浏览器 E2E 测试 | Playwright 测试文件 |

```yaml
tests:
  suites:
    - name: API 测试
      id: api
      file: tests/api.yaml              # YAML 运行器（默认）

    - name: 集成测试
      id: integration
      runner: vitest
      file: tests/integration/
      config: vitest.config.ts

    - name: Python 测试
      id: pytest-suite
      runner: pytest
      file: tests/

    - name: 冒烟测试
      id: smoke
      runner: shell
      file: scripts/smoke-test.sh

    - name: 自定义命令
      id: custom
      runner: exec
      command: "curl -sf http://localhost:8080/health"

    - name: 浏览器测试
      id: browser
      runner: playwright
      file: tests/e2e/
```

## MCP Server（AI 集成）

ArgusAI 提供 MCP Server，让 AI 编程助手（如 Cursor、Claude Desktop）可以直接执行 E2E 测试。

### 配置 Cursor

在项目根目录的 `.cursor/mcp.json`（或 Cursor 全局 MCP 配置）中添加：

```json
{
  "mcpServers": {
    "argusai": {
      "command": "npx",
      "args": ["argusai-mcp"]
    }
  }
}
```

### MCP 工具列表

| 工具 | 说明 |
|------|------|
| `argus_init` | 初始化项目（加载 e2e.yaml） |
| `argus_build` | 构建 Docker 镜像（含熔断器保护） |
| `argus_setup` | 启动测试环境（含预检、端口解析、孤儿清理、网络验证） |
| `argus_run` | 运行所有/指定测试套件 |
| `argus_run_suite` | 运行单个测试套件 |
| `argus_status` | 查看环境状态 |
| `argus_logs` | 查看容器日志 |
| `argus_clean` | 清理资源 |
| `argus_mock_requests` | 查看 Mock 请求录制 |
| `argus_preflight_check` | 主动检查环境健康（Docker 守护进程、磁盘空间、孤儿资源） |
| `argus_reset_circuit` | 重置熔断器状态（open → half-open） |
| `argus_history` | 查询历史运行记录（支持过滤、分页） |
| `argus_trends` | 获取趋势数据（通过率、时长、flaky 排行） |
| `argus_flaky` | 获取 Flaky Test 列表（按不稳定程度排序） |
| `argus_compare` | 对比两次运行的差异 |
| `argus_diagnose` | 智能失败诊断（分类 + 知识库匹配 + 修复建议） |
| `argus_report_fix` | 回报修复结果（更新知识库置信度） |
| `argus_patterns` | 查看/搜索失败模式知识库 |
| `argus_mock_generate` | 从 OpenAPI spec 生成 Mock YAML 配置 |
| `argus_mock_validate` | 验证 Mock 配置对 OpenAPI spec 的覆盖度 |
| `argus_dev` | 一键启动项目供手动测试（init + build + setup，返回访问地址） |
| `argus_rebuild` | 一键重建测试环境（clean + init + build + setup） |
| `argus_resources` | 查看所有 ArgusAI 管理的 Docker 资源（跨项目） |

### AI 工作流示例

通过 MCP，AI 助手可以执行完整的测试循环：

```
1. argus_preflight_check(projectPath)    → 检查环境健康（可选）
2. argus_init(projectPath)               → 加载项目配置
3. argus_build(projectPath)              → 构建镜像（熔断器保护）
4. argus_setup(projectPath)              → 启动环境（预检 + 端口解析 + 孤儿清理 + 网络验证）
5. argus_run(projectPath)                → 执行测试
6. argus_logs(projectPath, container)    → 查看失败日志
7. argus_clean(projectPath)              → 清理
```

当测试失败时，AI 可以智能诊断：
```
argus_diagnose(projectPath, runId, caseName)  → 分类失败 + 匹配知识库 + 获取修复建议
argus_flaky(projectPath)                       → 检查是否为 Flaky Test
argus_report_fix(projectPath, runId, ...)      → 修复成功后反馈，提升知识库置信度
```

开发者想手动测试时，一键启动：
```
argus_dev(projectPath)       → 构建 + 启动环境，返回访问 URL（如有健康会话则直接复用）
argus_clean(projectPath)     → 测试完毕后清理
```

当 Docker 环境异常时，AI 可以：
```
argus_preflight_check(projectPath, autoFix: true)  → 诊断并自动修复
argus_reset_circuit(projectPath)                     → 重置熔断器
```

查询历史趋势：
```
argus_history(projectPath, limit: 20)          → 最近 20 次运行记录
argus_trends(projectPath, metric: "pass-rate") → 通过率趋势
argus_compare(projectPath, runId1, runId2)     → 对比两次运行差异
```

## Dashboard

ArgusAI 提供可视化 Dashboard 用于实时监控测试。

```bash
argusai dashboard
```

功能包括：
- 实时测试执行状态展示
- 容器状态和日志查看
- 测试结果历史
- Mock 服务请求录制查看
- API Explorer（支持自定义预设端点）
- 配置编辑器
- **趋势分析页面** — 通过率折线图、执行时间趋势、Flaky Test 排行、运行时间轴

## 报告格式

| 格式 | 用途 |
|------|------|
| Console | 终端彩色实时输出（默认） |
| JSON | 机器可读的结构化报告，适合 CI |
| HTML | 自包含的 HTML 报告文件，可离线查看 |

```bash
# JSON 报告
argusai run --reporter json > report.json
```

## CI/CD 集成

项目提供开箱即用的 CI 模板，位于 `ci-templates/` 目录。

### GitLab CI

```yaml
include:
  - local: 'ci-templates/gitlab-ci.yml'

variables:
  PROJECT_PATH: .
  TEST_FILTER: ''
```

### GitHub Actions

```yaml
jobs:
  e2e:
    uses: ./.github/workflows/argusai-e2e.yml
    with:
      project_path: .
      test_filter: ''
```

详见 `ci-templates/` 目录中的完整模板。

## 架构概览

```
argusai/
├── packages/
│   ├── core/             # 核心引擎（argusai-core）
│   │   └── src/
│   │       ├── config-loader.ts      # YAML 配置加载 + Zod 验证
│   │       ├── docker-engine.ts      # Docker CLI 封装
│   │       ├── yaml-engine.ts        # YAML 测试执行引擎
│   │       ├── mock-generator.ts     # Mock 服务生成器（Fastify）
│   │       ├── assertion-engine.ts   # 断言 DSL 引擎
│   │       ├── variable-resolver.ts  # 变量模板解析
│   │       ├── test-runner.ts        # RunnerRegistry
│   │       ├── reporters.ts          # Console/JSON/HTML 报告
│   │       ├── runners/              # 测试运行器实现
│   │       ├── resilience/           # 韧性与自愈子系统
│   │       │   ├── error-codes.ts    #   结构化错误码（13 种）
│   │       │   ├── preflight.ts      #   预检健康检查
│   │       │   ├── container-guardian.ts  # 容器自动重启
│   │       │   ├── port-resolver.ts  #   端口冲突规避
│   │       │   ├── orphan-cleaner.ts #   孤儿资源清理
│   │       │   ├── circuit-breaker.ts #  熔断器
│   │       │   └── network-verifier.ts # 网络韧性验证
│   │       ├── history/              # 测试持久化与趋势分析
│   │       │   ├── history-store.ts  #   SQLite 持久化存储
│   │       │   ├── memory-history-store.ts # 内存存储（测试/CI 用）
│   │       │   ├── history-recorder.ts #  测试运行记录器
│   │       │   ├── flaky-detector.ts #   Flaky Test 识别引擎
│   │       │   └── migrations.ts     #   数据库迁移
│   │       ├── knowledge/            # 智能诊断与知识库
│   │       │   ├── classifier.ts     #   失败分类器（10 类）
│   │       │   ├── normalizer.ts     #   错误消息规范化
│   │       │   ├── diagnostics-engine.ts # 诊断引擎
│   │       │   ├── knowledge-store.ts #  修复知识库存储
│   │       │   └── built-in-patterns.ts # 内置失败模式
│   │       └── openapi/              # OpenAPI 智能 Mock
│   │           ├── spec-loader.ts    #   OpenAPI 3.0/3.1 解析器
│   │           ├── route-builder.ts  #   Mock 路由生成
│   │           ├── response-generator.ts # 响应体生成
│   │           ├── request-validator.ts # 请求 schema 验证
│   │           └── recorder.ts       #   录制/回放引擎
│   │       ├── port-allocator.ts     # 进程级端口注册中心（多项目隔离）
│   │       └── resource-limiter.ts   # 并发资源控制
│   │
│   ├── cli/              # CLI 工具（argusai）
│   ├── dashboard/        # 可视化面板（argusai-dashboard）
│   └── mcp/              # MCP Server（argusai-mcp）
│
├── examples/             # 示例项目
├── ci-templates/         # CI/CD 模板
├── mcp-templates/        # MCP 配置模板
└── schemas/              # JSON Schema（IDE 自动补全）
```

### 技术栈

| 模块 | 技术 |
|------|------|
| 配置验证 | Zod |
| YAML 解析 | js-yaml |
| Mock 服务器 | Fastify |
| OpenAPI 解析 | @readme/openapi-parser |
| 请求验证 | Ajv |
| Docker 操作 | Docker CLI (child_process) |
| CLI 框架 | Commander.js |
| 持久化存储 | better-sqlite3 (WAL mode) |
| Dashboard | React + Vite + Tailwind CSS |
| 图表 | Recharts |
| 实时通信 | SSE (Server-Sent Events) |
| 运行时 | Node.js >= 20 |

## 韧性与自愈

ArgusAI 内置了完整的错误恢复与自愈系统，将错误处理从「报错停止」升级为「恢复继续」。

| 能力 | 说明 | 关键配置 |
|------|------|---------|
| **结构化错误码** | 13 种 AI 可解析的错误码（如 `DOCKER_UNAVAILABLE`、`PORT_CONFLICT`），附带类别、严重等级和修复建议 | — |
| **预检健康检查** | 操作前自动检查 Docker 守护进程、磁盘空间、孤儿资源 | `resilience.preflight` |
| **容器自动重启** | 崩溃容器自动诊断（exit code/OOM/日志）并退避重启 | `resilience.container` |
| **端口冲突规避** | 自动检测被占用端口并分配替代端口，或快速失败 | `resilience.network.portConflictStrategy` |
| **孤儿资源清理** | 通过 Docker Label 识别并清理上次运行残留的容器和网络 | `resilience.preflight.cleanOrphans` |
| **熔断器** | Docker CLI 连续失败后自动熔断，所有后续操作 < 100ms 快速失败 | `resilience.circuitBreaker` |
| **网络韧性** | 启动后验证 Mock 服务 DNS 可达性和 TCP 连通性 | `resilience.network.verifyConnectivity` |

所有韧性事件通过 SSE 实时推送，Dashboard 可实时展示。

## 测试持久化与趋势分析

ArgusAI 自动持久化每次测试运行的结果，支持 Flaky Test 识别和趋势分析。

```yaml
history:
  enabled: true
  storage: local       # local (SQLite) | memory (CI/测试)
  retention: 90d       # 保留天数
  flakyWindow: 10      # Flaky 检测滑动窗口大小
```

| 能力 | 说明 |
|------|------|
| **自动持久化** | 每次 `argus_run` 的结果自动写入 SQLite |
| **Flaky 识别** | 滑动窗口算法，5 级稳定性分类（STABLE → BROKEN） |
| **趋势分析** | 通过率、执行时长、Flaky 排行、运行对比 |
| **Dashboard** | 通过率折线图、时长趋势、Flaky 排行表、运行时间轴 |

AI Agent 使用场景：测试失败 → 查询 flaky score → 判断是否为已知不稳定测试 → 决定忽略或修复。

## 智能诊断建议

内置失败模式知识库，自动分类诊断失败原因并给出修复建议。

| 能力 | 说明 |
|------|------|
| **失败分类** | 10 类自动分类（ASSERTION_MISMATCH、HTTP_ERROR、TIMEOUT 等） |
| **错误签名** | 规范化错误消息 + SHA-256 签名，精确匹配历史模式 |
| **修复知识库** | 内置 6 个常见模式 + 自学习模式，Laplace 平滑置信度评分 |
| **反馈闭环** | Agent 修复成功后通过 `argus_report_fix` 反馈，持续提升知识库质量 |

AI Agent 使用场景：测试失败 → `argus_diagnose` 自动分类 → 匹配知识库 → 获取修复建议和置信度 → 修复后反馈。

## 多项目隔离

支持多个项目在同一台机器、同一 MCP Server 实例下并发运行，互不干扰。

| 能力 | 说明 |
|------|------|
| **项目命名空间网络** | 默认 Docker 网络名为 `argusai-<project-slug>-network`，不同项目使用各自独立的网络 |
| **端口注册中心** | `PortAllocator` 进程级单例，并发 setup 时跨项目协调端口分配，消除端口抢占竞争 |
| **自定义命名空间** | 通过 `isolation.namespace` 自定义资源前缀；`isolation.portRange` 指定可分配的端口范围 |
| **资源全局视图** | `argus_resources` 工具查询所有 `argusai.managed=true` 的 Docker 容器和网络，按项目分组展示 |

```yaml
isolation:
  namespace: my-project     # 可选，默认从 project.name 推导
  portRange: [10000, 10999] # 可选，默认 [9000, 9999]
```

AI Agent 使用场景：`argus_resources` → 一眼看到哪些项目的哪些容器/网络还在跑 → 精准清理目标项目。

## OpenAPI 智能 Mock

从 OpenAPI 3.0/3.1 spec 一键生成 Mock 路由，支持请求验证和录制/回放。

```yaml
mocks:
  payment-api:
    port: 9082
    openapi: ./specs/payment.yaml   # OpenAPI spec 文件
    mode: auto                       # auto | record | replay | smart
    validate: true                   # 请求 schema 验证（不符合返回 422）
    target: http://real-api:8080     # record 模式的代理目标
    overrides:                       # 手动覆盖路由（优先级最高）
      - method: POST
        path: /api/charge
        response:
          status: 200
          body: { charged: true }
```

| 模式 | 行为 |
|------|------|
| `auto` | 基于 OpenAPI schema 自动生成响应（优先使用 example 字段） |
| `record` | 代理请求到真实 API 并录制响应 |
| `replay` | 从录制文件回放响应 |
| `smart` | 有录制就回放，没有就自动生成 |

通过 `X-Mock-Status` request header 可切换返回的 HTTP 状态码。

## 开发

```bash
git clone <repo-url>
cd argusai
pnpm install
pnpm build
pnpm test:run
```

## License

MIT
