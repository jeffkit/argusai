# ArgusAI 插件开发指南

> 最后更新：2026-05-27

本文档面向希望扩展 ArgusAI 功能的开发者，介绍如何通过 `e2e.yaml` 的 `plugins` 字段加载自定义插件模块。

---

## 一、什么是 ArgusAI 插件

ArgusAI 插件是一个普通的 JavaScript/TypeScript 模块，通过 `e2e.yaml` 的 `plugins` 字段声明，在每次运行测试前自动加载。

插件可以：
- **注册自定义断言类型**（扩展 YAML 测试用例的 `assert.type`）
- **执行全局初始化**（连接数据库、初始化 Fixtures、设置全局存根等）
- **执行全局清理**（关闭连接、清理资源等）

> **提示：** ArgusAI 的 CLI（`argusai run`）和 MCP 工具（`argus_init`）都会自动加载插件，无需额外配置。

---

## 二、快速开始

### 1. 编写插件模块

```ts
// plugins/my-plugin.ts（或 .js、.mjs）
import type { PluginModule } from 'argusai-core';

const plugin: PluginModule = {
  name: 'my-plugin',

  async setup() {
    console.log('[my-plugin] 初始化中...');
    // 在此连接数据库、准备测试数据等
  },

  async teardown() {
    console.log('[my-plugin] 清理中...');
    // 在此关闭连接、删除测试数据等
  },

  assertionPlugins: [
    {
      name: 'my-assert',
      assert(type, input, config) {
        if (!type.startsWith('my-assert')) return [];
        // 自定义断言逻辑
        const value = input as string;
        const expected = (config as { value: string }).value;
        return [{
          passed: value === expected,
          message: `Expected "${expected}", got "${value}"`,
        }];
      },
    },
  ],
};

export default plugin;
```

### 2. 在 `e2e.yaml` 中声明插件

```yaml
version: "1"
project:
  name: my-service

plugins:
  - ./plugins/my-plugin.js   # 相对于 e2e.yaml 所在目录

tests:
  suites:
    - name: API 测试
      id: api
      file: tests/api.yaml
```

### 3. 在测试用例中使用自定义断言

```yaml
# tests/api.yaml
name: 验证自定义字段
steps:
  - action: GET /api/value
assert:
  - type: my-assert
    input: "{{response.body.value}}"
    config:
      value: "expected-value"
```

---

## 三、插件模块规范

### `PluginModule` 接口

```ts
interface PluginModule {
  /** 插件名称，用于日志和错误提示（必填） */
  name: string;

  /**
   * 全局初始化钩子，在所有测试套件执行前调用一次。
   * 可用于连接数据库、准备 Fixtures、设置全局存根等。
   */
  setup?: () => Promise<void> | void;

  /**
   * 全局清理钩子，在所有测试套件执行完毕后调用（无论成功/失败）。
   * 按逆序调用（最后加载的插件最先 teardown）。
   */
  teardown?: () => Promise<void> | void;

  /**
   * 要注册到断言引擎的自定义断言插件列表。
   * 每个条目在 loadPlugins() 时自动注册到 globalAssertionPluginRegistry。
   */
  assertionPlugins?: AssertionPlugin[];
}
```

### `AssertionPlugin` 接口

```ts
interface AssertionPlugin {
  /** 断言类型前缀（唯一，用于匹配 YAML 中的 assert.type） */
  name: string;

  /**
   * 执行断言逻辑。
   * @param type   - assert.type 字段值（如 "my-assert.strict"）
   * @param input  - 断言输入（如响应体、文件路径等）
   * @param config - 插件特定配置（来自 YAML assert.config 字段）
   * @returns 断言结果数组，不处理该类型时返回 []
   */
  assert(type: string, input: unknown, config: unknown): AssertionResult[];
}
```

---

## 四、插件路径解析规则

`e2e.yaml` 中 `plugins` 字段支持三种路径格式：

| 格式 | 示例 | 解析方式 |
|------|------|---------|
| 相对路径 | `./plugins/my-plugin.js` | 相对于 `e2e.yaml` 所在目录 |
| 绝对路径 | `/opt/plugins/shared-plugin.js` | 直接使用 |
| npm 包名 | `argusai-plugin-db-fixtures` | 由 Node.js 模块解析（需已安装） |

```yaml
plugins:
  - ./plugins/local-plugin.js        # 本地相对路径
  - /opt/shared/company-plugin.mjs   # 绝对路径
  - argusai-plugin-db-fixtures       # npm 包
```

---

## 五、发布可复用插件到 npm

如果你的插件需要在多个项目复用，可以将其发布为 npm 包：

```ts
// index.ts
import type { PluginModule } from 'argusai-core';

export const plugin: PluginModule = {
  name: 'argusai-plugin-my-org',
  // ...
};

export default plugin;
```

```json
// package.json
{
  "name": "argusai-plugin-my-org",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "peerDependencies": {
    "argusai-core": ">=0.9.0"
  }
}
```

安装后直接在 `e2e.yaml` 中引用包名：

```yaml
plugins:
  - argusai-plugin-my-org
```

---

## 六、加载顺序与错误处理

- 插件按 `plugins` 数组中的**声明顺序**依次加载
- 每个插件的 `setup()` 按加载顺序调用
- 每个插件的 `teardown()` 按**逆序**调用（类似 stack 弹出）
- 若某个插件加载失败（`import()` 错误、`name` 缺失、断言名冲突），**测试不会运行**，CLI 以非零退出码退出
- `teardown()` 中的错误只会打印警告，不会中止其余插件的 teardown

---

## 七、与现有代码集成

如果你已经有通过 `globalAssertionPluginRegistry.register()` 注册断言的代码，无需迁移——两种方式**并存**，`plugins` 字段只是额外提供了一种通过配置文件声明的路径。

```ts
// 旧方式（仍然有效）：在你的代码中直接注册
import { globalAssertionPluginRegistry } from 'argusai-core';

globalAssertionPluginRegistry.register({
  name: 'my-assert',
  assert(type, input, config) { ... },
});
```

```yaml
# 新方式：通过 e2e.yaml plugins 字段声明
plugins:
  - ./plugins/my-plugin.js
```

---

## 八、完整示例：数据库 Fixtures 插件

```ts
// plugins/db-fixtures.ts
import type { PluginModule, AssertionPlugin, AssertionResult } from 'argusai-core';
import { createPool, type Pool } from 'pg';

let pool: Pool;

const dbAssertPlugin: AssertionPlugin = {
  name: 'db',
  assert(type, input, config): AssertionResult[] {
    if (!type.startsWith('db.')) return [];

    if (type === 'db.row-count') {
      const { table, count } = config as { table: string; count: number };
      // 同步占位，真实场景建议在 setup 中预计算结果并缓存
      return [{ passed: true, message: `Table ${table} row count check deferred` }];
    }
    return [];
  },
};

const plugin: PluginModule = {
  name: 'db-fixtures',

  async setup() {
    pool = createPool({ connectionString: process.env.TEST_DATABASE_URL });
    // 初始化测试数据
    await pool.query('TRUNCATE TABLE orders, users CASCADE');
    await pool.query(`INSERT INTO users VALUES (1, 'test@example.com')`);
    console.log('[db-fixtures] 测试数据初始化完成');
  },

  async teardown() {
    await pool?.end();
    console.log('[db-fixtures] 数据库连接已关闭');
  },

  assertionPlugins: [dbAssertPlugin],
};

export default plugin;
```

```yaml
# e2e.yaml
plugins:
  - ./plugins/db-fixtures.js

tests:
  suites:
    - name: 订单 API 测试
      id: orders
      file: tests/orders.yaml
```
