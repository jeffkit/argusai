# ArgusAI 业务接入指南

> 最后更新：2026-02-27

本文档面向希望使用 ArgusAI 进行 E2E 测试的业务团队，覆盖从环境准备到 CI 接入的完整流程。

---

## 一、ArgusAI 是什么

ArgusAI 是一个**配置驱动的 Docker 容器端到端测试平台**。你只需要编写 YAML 配置文件，ArgusAI 就能自动完成：

1. **构建** Docker 镜像
2. **启动** 容器和 Mock 服务
3. **执行** HTTP 测试用例并断言结果
4. **清理** 所有资源

同时提供 MCP Server 集成，AI 编程助手（如 Cursor）可以直接调用测试工具。

### 适用场景

- 服务端 API 端到端测试
- 微服务间接口联调验证
- 依赖外部服务的 Mock 测试
- CI/CD 流水线中的自动化验收
- AI 辅助开发时的自动化回归测试

---

## 二、环境准备

### 必需软件

| 软件 | 版本要求 | 验证命令 |
|------|---------|----------|
| Node.js | >= 20.0 | `node --version` |
| pnpm | >= 10.0 | `pnpm --version` |
| Docker | >= 24.0 | `docker --version` |

> Docker Desktop 或 Docker Engine 均可，确保 Docker Daemon 已启动。

### 安装 ArgusAI CLI

```bash
# 全局安装（推荐）
npm install -g argusai

# 验证安装
argusai --version
```

或在项目中作为开发依赖安装：

```bash
pnpm add -D argusai argusai-core
```

---

## 三、接入步骤

### Step 1: 在你的项目中初始化

```bash
cd /path/to/your/project
argusai init
```

将生成以下文件：

```
your-project/
├── e2e.yaml           # 主配置文件 ← 编辑此文件
├── tests/
│   └── health.yaml    # 示例测试用例
└── .env.example       # 环境变量模板
```

### Step 2: 配置 e2e.yaml

根据你的项目实际情况编辑 `e2e.yaml`：

```yaml
version: "1"

project:
  name: your-project-name        # 你的项目名称
  description: "项目 E2E 测试"

service:
  build:
    dockerfile: Dockerfile        # 你的 Dockerfile 路径
    context: .                    # 构建上下文（通常为项目根目录）
    image: your-project:e2e       # 镜像名称

  container:
    name: your-project-e2e        # 容器名称
    ports:
      - "8080:3000"               # 宿主机端口:容器端口
    environment:
      NODE_ENV: test
      DATABASE_URL: "{{env.DATABASE_URL}}"  # 引用环境变量
    healthcheck:
      path: /health               # 你的健康检查端点
      port: 3000                  # 容器内端口（可选，默认从 ports 自动推断）
      interval: 5s
      timeout: 3s
      retries: 10
      startPeriod: 15s

  vars:
    base_url: http://localhost:8080  # 测试中可通过 {{config.base_url}} 引用
```

**关键配置项说明：**

| 配置项 | 必填 | 说明 |
|--------|------|------|
| `service.build.dockerfile` | 是 | 你的 Dockerfile 路径 |
| `service.build.image` | 是 | 构建的镜像名称 |
| `service.container.name` | 是 | 运行的容器名称 |
| `service.container.ports` | 是 | 端口映射，格式 `宿主机:容器` |
| `service.container.healthcheck` | 否 | 健康检查配置（强烈建议配置） |
| `service.vars` | 否 | 自定义变量，测试中可引用 |

### Step 3: 编写测试用例

在 `tests/` 目录下创建 YAML 测试文件：

```yaml
name: API 基本测试
description: 验证核心 API 接口
sequential: true

setup:
  - waitHealthy:
      timeout: 60s

cases:
  - name: "健康检查"
    request:
      method: GET
      path: /health
    expect:
      status: 200
      body:
        status: ok

  - name: "创建资源"
    request:
      method: POST
      path: /api/resources
      headers:
        Content-Type: application/json
      body:
        name: "test-resource"
        type: "demo"
    expect:
      status: 201
      body:
        id: { exists: true }
        name: "test-resource"
    save:
      resource_id: "id"

  - name: "查询创建的资源"
    request:
      method: GET
      path: "/api/resources/{{runtime.resource_id}}"
    expect:
      status: 200
      body:
        name: "test-resource"
```

### Step 4: 配置 Mock 服务（如需要）

如果你的服务依赖外部 API，可以在 `e2e.yaml` 中配置 Mock：

```yaml
mocks:
  payment-gateway:
    port: 9081
    containerPort: 8081           # 容器内通过此端口访问
    routes:
      - method: POST
        path: /api/pay
        response:
          status: 200
          body:
            order_id: "{{uuid}}"
            status: "success"

      - method: GET
        path: /api/orders/:id
        response:
          status: 200
          body:
            id: "{{request.params.id}}"
            amount: 100.00
```

然后在容器环境变量中将依赖的外部服务地址指向 Mock：

```yaml
service:
  container:
    environment:
      PAYMENT_GATEWAY_URL: http://host.docker.internal:9081
```

### Step 5: 在 e2e.yaml 中注册测试套件

```yaml
tests:
  suites:
    - name: API 基本测试
      id: api
      file: tests/api.yaml

    - name: 支付流程测试
      id: payment
      file: tests/payment.yaml
```

### Step 6: 运行测试

```bash
# 构建镜像
argusai build

# 启动测试环境
argusai setup

# 运行所有测试
argusai run

# 或只运行指定套件
argusai run -s api

# 查看状态
argusai status

# 查看日志（排查问题时）
argusai logs -n 200

# 测试完成后清理
argusai clean
```

---

## 四、CI/CD 接入

### GitLab CI

在你的 `.gitlab-ci.yml` 中添加：

```yaml
e2e-test:
  image: node:20
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_CERTDIR: '/certs'
  before_script:
    - corepack enable
    - corepack prepare pnpm@10 --activate
    - npm install -g argusai
  script:
    - argusai build -c e2e.yaml
    - argusai setup -c e2e.yaml
    - argusai run -c e2e.yaml --reporter json > test-results.json
  after_script:
    - argusai clean -c e2e.yaml --force || true
  artifacts:
    when: always
    paths:
      - test-results.json
    expire_in: 30 days
```

也可使用我们提供的模板（位于 `ci-templates/gitlab-ci.yml`）：

```yaml
include:
  - project: 'infra/argusai'
    file: 'ci-templates/gitlab-ci.yml'

variables:
  PROJECT_PATH: .
```

### GitHub Actions

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - run: npm install -g argusai
      - run: argusai build
      - run: argusai setup
      - run: argusai run --reporter json > test-results.json
      - run: argusai clean --force
        if: always()

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results
          path: test-results.json
```

---

## 五、AI 编程助手集成

如果你的团队使用 AI 编程工具，可以让 AI 助手直接执行 E2E 测试。

### 方式一：Claude Code Plugin（推荐）

两行命令安装，AI 自动获得 MCP 工具 + Skill + 斜杠命令：

```bash
# 注册 marketplace（只需一次）
claude plugin marketplace add jeffkit/argusai-marketplace

# 安装 plugin
claude plugin install argusai
```

安装后 AI 自动获得：
- 21 个 MCP 工具（构建、启动、测试、日志、历史趋势、智能诊断、OpenAPI Mock、多项目隔离等全流程）
- `/run-tests` 和 `/init-e2e` 斜杠命令
- 自动触发的 Skill（检测到 e2e.yaml 或用户说"跑测试"时激活）

### 方式二：手动配置 MCP Server（Cursor 等）

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

### AI 可用的工具

配置后，AI 助手可以使用以下 21 个工具：

**核心测试流程：**

| 工具名 | 说明 | 典型场景 |
|--------|------|----------|
| `argus_init` | 初始化项目 | 首次加载配置 |
| `argus_build` | 构建镜像 | 代码变更后 |
| `argus_setup` | 启动环境 | 准备测试 |
| `argus_run` | 运行测试 | 验证修改 |
| `argus_run_suite` | 运行单个套件 | 针对性测试 |
| `argus_status` | 查看状态 | 排查问题 |
| `argus_logs` | 查看日志 | 分析失败原因 |
| `argus_clean` | 清理资源 | 测试完成后 |
| `argus_mock_requests` | 查看 Mock 录制 | 验证请求是否正确 |

**韧性与自愈：**

| 工具名 | 说明 | 典型场景 |
|--------|------|----------|
| `argus_preflight_check` | 环境预检 | Docker/磁盘/孤儿资源诊断 |
| `argus_reset_circuit` | 重置熔断器 | Docker 恢复后解除熔断 |

**历史与趋势：**

| 工具名 | 说明 | 典型场景 |
|--------|------|----------|
| `argus_history` | 历史运行记录 | 查看最近测试结果 |
| `argus_trends` | 趋势数据 | 通过率/时长变化趋势 |
| `argus_flaky` | Flaky 排行榜 | 识别不稳定测试 |
| `argus_compare` | 运行对比 | 对比两次运行差异 |

**智能诊断：**

| 工具名 | 说明 | 典型场景 |
|--------|------|----------|
| `argus_diagnose` | 失败诊断 | 自动分类 + 知识库匹配 + 修复建议 |
| `argus_report_fix` | 回报修复 | 修复成功后反馈知识库 |
| `argus_patterns` | 失败模式库 | 查看已知失败模式 |

**OpenAPI Mock：**

| 工具名 | 说明 | 典型场景 |
|--------|------|----------|
| `argus_mock_generate` | 生成 Mock 配置 | 从 OpenAPI spec 自动生成 |
| `argus_mock_validate` | Mock 覆盖度检查 | 确认 Mock 覆盖所有端点 |

**多项目隔离：**

| 工具名 | 说明 | 典型场景 |
|--------|------|----------|
| `argus_resources` | 全局资源视图 | 查看所有项目的容器/网络/端口占用，排查资源冲突 |

### 使用场景

开发者在 Cursor 中修改代码后，AI 助手可以自动：
1. 构建新镜像
2. 启动测试环境
3. 执行相关测试套件
4. 分析测试结果（如失败，自动诊断并查询历史模式）
5. 清理环境

---

## 六、交付清单

以下是业务团队接入 ArgusAI 需要获取的交付物：

| 序号 | 交付物 | 说明 |
|------|--------|------|
| 1 | **ArgusAI CLI** | `npm install -g argusai` 安装 |
| 2 | **本接入指南** | `docs/ONBOARDING.md` |
| 3 | **README** | 完整的使用参考文档 |
| 4 | **示例项目** | `examples/` 目录下的 demo-project |
| 5 | **CI/CD 模板** | `ci-templates/` 目录（GitLab CI + GitHub Actions） |
| 6 | **MCP 配置模板** | `mcp-templates/cursor-mcp-config.json` |
| 7 | **JSON Schema** | `schemas/` 目录，用于 IDE 自动补全 |
| 8 | **YAML 测试配置参考** | `docs/yaml-test-config.md` 详细语法文档 |

---

## 七、常见问题

### Q: 需要在项目中安装什么依赖？

只需安装 CLI 工具：`npm install -g argusai`。如果想在项目中锁定版本，可以 `pnpm add -D argusai argusai-core`。

### Q: Docker 镜像构建很慢怎么办？

- 确保 Dockerfile 利用了多阶段构建和层缓存
- 使用 `.dockerignore` 排除 `node_modules`、`.git` 等大目录
- 首次构建慢属正常现象，后续增量构建会更快

### Q: 如何在容器内访问 Mock 服务？

Mock 服务运行在宿主机上。在容器内通过 `host.docker.internal` 访问：
```yaml
environment:
  EXTERNAL_API: http://host.docker.internal:9081
```

或在配置中设置 `containerPort`，ArgusAI 会自动将 Mock 容器加入同一 Docker 网络。

### Q: 测试执行超时怎么办？

1. 检查健康检查配置是否合理（`startPeriod` 和 `retries` 是否足够）
2. 使用 `argusai logs` 查看容器日志排查启动问题
3. 通过 `--timeout` 参数延长超时：`argusai run --timeout 120000`

### Q: 如何查看 Mock 收到了哪些请求？

```bash
# 通过 CLI 查看
curl http://localhost:9081/_mock/requests

# 或在 Dashboard 中查看
argusai dashboard
```

### Q: 多个项目同时测试会端口冲突吗？

不会。ArgusAI 采用项目命名空间隔离：

- 每个项目的 Docker 网络默认命名为 `argusai-<project>-network`，互不干扰
- 内置 `PortAllocator` 进程级端口注册中心，并发 setup 时跨项目协调端口分配，消除端口抢占
- 可通过 `isolation.portRange` 给不同项目划分专属端口段：

```yaml
# 项目 A
isolation:
  portRange: [9000, 9099]

# 项目 B
isolation:
  portRange: [9100, 9199]
```

用 `argus_resources`（MCP 工具）或 `argusai status` 可查看全局资源占用情况。

### Q: 已经有 docker-compose 管理容器，可以只用 ArgusAI 跑测试吗？

可以。使用**纯测试模式（test-only mode）**：只保留 `tests` 配置，不定义 `service`/`services`，同时禁用 preflight 检查：

```yaml
version: "1"
project:
  name: my-stack

resilience:
  preflight:
    enabled: false

tests:
  suites:
    - name: Health Check
      id: health
      file: tests/health.yaml
```

测试文件中直接使用完整 URL：
```yaml
cases:
  - name: "服务健康检查"
    request:
      method: GET
      url: http://localhost:3000/health
    expect:
      status: 200
```

### Q: 支持多服务编排吗？

支持。使用 `services` 数组配置多个服务：

```yaml
services:
  - name: api-server
    build:
      dockerfile: Dockerfile.api
      image: api:e2e
    container:
      name: api-e2e
      ports: ["8080:3000"]

  - name: worker
    build:
      dockerfile: Dockerfile.worker
      image: worker:e2e
    container:
      name: worker-e2e
      ports: ["8081:3000"]
```

---

## 八、获取帮助

- 完整文档：参见 `README.md`
- YAML 测试语法详解：参见 `docs/yaml-test-config.md`
- 示例项目：参见 `examples/` 目录
- 问题反馈：请联系基础设施团队
