# 代码的百眼守护者：ArgusAI 让 E2E 测试回归本质

> 写测试不应该比写业务代码更难。

---

## 一个让人头疼的问题

你有没有遇到过这种情况：

- 本地测试全过，一上 CI 就炸
- Mock 服务配了半天，和真实接口行为差了十万八千里
- E2E 测试脚本写了两千行，维护起来比业务代码还复杂
- AI 写了代码，但没法让它自动跑测试验证结果

这些问题的根源，其实是同一个：**E2E 测试的基础设施太重了。**

你不得不同时操心 Docker 编排、Mock 服务、端口冲突、容器清理……写出来的测试代码，大半精力都花在了「让测试跑起来」上，而不是「测什么、怎么断言」。

**ArgusAI 就是为了解决这个问题而生的。**

---

## ArgusAI 是什么

ArgusAI 是一个**配置驱动的 Docker 容器端到端测试平台**。

它的核心理念很简单：**你只需要声明你要测什么，剩下的交给它。**

```yaml
# e2e.yaml —— 这就是全部配置
version: "1"
project:
  name: my-service

service:
  build:
    dockerfile: Dockerfile
    image: my-service:e2e
  container:
    name: my-service-e2e
    ports: ["8080:3000"]
    healthcheck:
      path: /health

tests:
  suites:
    - name: API 测试
      id: api
      file: tests/api.yaml
```

一个 YAML 文件，描述你的服务长什么样、测试在哪里。然后：

```bash
argusai build   # 构建镜像
argusai setup   # 启动容器 + Mock 服务
argusai run     # 跑测试
argusai clean   # 清理干净
```

就这四步。不需要写一行 Docker Compose、不需要管网络、不需要担心端口冲突。

---

## 测试用例也是声明式的

ArgusAI 的测试用例同样是 YAML，而且非常接近自然语言：

```yaml
name: 用户注册接口测试

cases:
  - name: "正常注册 - 返回用户 ID"
    request:
      method: POST
      path: /api/users
      body:
        email: test@example.com
        password: "123456"
    expect:
      status: 201
      body:
        id: { $exists: true }
        email: test@example.com
    save:
      new_user_id: "id"   # 保存 id，供下一个用例使用

  - name: "重复注册 - 返回冲突错误"
    request:
      method: POST
      path: /api/users
      body:
        email: test@example.com
        password: "123456"
    expect:
      status: 409
      body:
        error: { $contains: "already exists" }
```

读一遍就知道在测什么，改一行就能调整断言。这就是声明式测试的价值。

---

## Mock 服务，一行配置搞定

微服务时代，测试最大的痛点之一就是外部依赖。ArgusAI 内置了 Mock 服务器，支持两种模式：

**手动配置路由：**

```yaml
mocks:
  payment-api:
    port: 9081
    routes:
      - method: POST
        path: /api/charge
        response:
          status: 200
          body: { id: "ch_123", status: "succeeded" }
```

**更强大的：从 OpenAPI spec 自动生成 Mock：**

```yaml
mocks:
  payment-api:
    port: 9081
    openapi: ./specs/payment-api.yaml  # OpenAPI 3.x spec 路径
    mode: auto       # 自动生成符合 schema 的响应
    validate: true   # 请求不合规时返回 422，不让垃圾请求溜进来
```

有了 OpenAPI Mock，你不再需要手动维护一堆假数据——ArgusAI 会根据你的接口文档自动模拟真实行为。

---

## 不止 HTTP：六种测试运行器

ArgusAI 不只能跑 HTTP 测试。通过 `runner` 字段，你可以接入任何测试框架：

```yaml
tests:
  suites:
    - name: 接口测试
      id: api
      file: tests/api.yaml
      runner: yaml          # 默认，YAML 声明式 HTTP 测试

    - name: 集成测试
      id: integration
      runner: vitest        # 接入 Vitest
      file: tests/integration/
      config: vitest.config.ts

    - name: Python 测试
      id: pytest-suite
      runner: pytest        # 接入 Pytest
      file: tests/

    - name: 浏览器测试
      id: browser
      runner: playwright    # 接入 Playwright，真实浏览器 E2E
      file: tests/e2e/

    - name: 自定义脚本
      id: smoke
      runner: shell
      command: "./scripts/smoke-test.sh"
```

不管你的项目用的是什么测试框架，ArgusAI 都能统一编排、统一报告。

---

## AI 原生：MCP 集成

这是 ArgusAI 区别于传统测试框架的关键特性。

ArgusAI 提供 MCP Server，让 **Cursor、Claude 等 AI 编程助手可以直接调用测试工具**，把「写完代码立刻跑 E2E 验证」变成一个自然的开发闭环。

在项目根目录加一行配置：

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "argusai": {
      "command": "npx",
      "args": ["argusai-mcp"]
    }
  }
}
```

之后，AI 助手就能执行完整的测试生命周期：

```
argus_init(projectPath)      → 加载配置
argus_build(projectPath)     → 构建镜像
argus_setup(projectPath)     → 启动环境
argus_run(projectPath)       → 跑测试
argus_diagnose(...)          → 失败？自动诊断 + 给修复建议
argus_clean(projectPath)     → 清理
```

你写完一个接口，告诉 AI「帮我跑一下 E2E」，它就能自己把整套流程走完，出问题了还会给你分析失败原因。

---

## 内置智能诊断

ArgusAI 有一个失败模式知识库。当测试失败时：

- 自动把失败分为 10 类（断言不符、超时、HTTP 错误、容器崩溃……）
- 在知识库里匹配历史相似失败
- 给出修复建议和置信度评分
- 你修复成功后，反馈一下，知识库会越来越准

```bash
argusai diagnose --run <run-id> --case "用例名"
```

这是把运维经验沉淀下来的第一步。

---

## v0.11.0 新特性：插件系统

从 v0.11.0 开始，ArgusAI 支持通过 `e2e.yaml` 加载自定义插件模块。

这意味着你可以把项目特有的测试能力（数据库 Fixtures 初始化、自定义断言类型、第三方服务存根……）封装成插件，在配置层声明，而不是混在测试代码里。

```yaml
# e2e.yaml
plugins:
  - ./plugins/db-fixtures.js   # 本地插件
  - my-org-test-plugin         # npm 包
```

```ts
// plugins/db-fixtures.ts
import type { PluginModule } from 'argusai-core';

export default {
  name: 'db-fixtures',

  async setup() {
    // 在所有套件运行前：初始化测试数据
    await seedTestData();
  },

  async teardown() {
    // 在所有套件结束后：清理
    await cleanupTestData();
  },

  assertionPlugins: [{
    name: 'db',
    assert(type, input, config) {
      // 自定义断言类型：在 YAML 里用 assert.type: db.row-count
      if (!type.startsWith('db.')) return [];
      return checkDbState(type, input, config);
    }
  }],
} satisfies PluginModule;
```

插件可以发布为 npm 包，在团队内复用。

---

## 快速上手

### 安装

```bash
npm install -g argusai
```

### 初始化项目

```bash
cd your-project
argusai init
```

自动生成 `e2e.yaml`、示例测试文件和 `.env.example`。

### 跑起来

```bash
argusai build && argusai setup && argusai run
```

### 看结果

```bash
argusai dashboard   # 可视化面板：实时状态 + 趋势图 + Mock 请求录制
```

---

## 当前版本：v0.11.0

| 包名 | 版本 | 说明 |
|------|------|------|
| `argusai` | 0.11.0 | CLI 工具 |
| `argusai-core` | 0.11.0 | 核心引擎（可单独集成） |
| `argusai-mcp` | 0.11.0 | MCP Server（AI 集成） |

---

## 写在最后

E2E 测试一直被认为是「又重要又麻烦」的事情。ArgusAI 想做的，就是把「麻烦」这部分尽可能消化掉——让你只需要思考「我要测什么」，而不是「测试环境怎么搭」。

如果你正在为 E2E 测试的复杂度发愁，或者想让 AI 助手真正参与到测试验证环节，不妨试试看。

**项目地址：** https://github.com/jeffkit/argusai

**npm：** `npm install -g argusai`

**文档：** `argusai --help`
