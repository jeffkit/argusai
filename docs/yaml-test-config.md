# YAML 测试用例配置参考

> 最后更新：2026-07-10

本文档详细说明 preflight 的 YAML 测试用例配置语法、所有断言工具和使用示例。

---

## 目录

- [1. 测试文件结构](#1-测试文件结构)
- [2. 测试步骤类型](#2-测试步骤类型)
  - [2.1 HTTP 请求步骤 (request)](#21-http-请求步骤-request)
  - [2.2 容器命令执行步骤 (exec)](#22-容器命令执行步骤-exec)
  - [2.3 文件断言步骤 (file)](#23-文件断言步骤-file)
  - [2.4 进程断言步骤 (process)](#24-进程断言步骤-process)
  - [2.5 端口断言步骤 (port)](#25-端口断言步骤-port)
- [3. HTTP 响应断言 (expect)](#3-http-响应断言-expect)
  - [3.1 状态码断言 (status)](#31-状态码断言-status)
  - [3.2 响应头断言 (headers)](#32-响应头断言-headers)
  - [3.3 响应体断言 (body)](#33-响应体断言-body)
  - [3.4 表达式断言 (expr)](#34-表达式断言-expr)
  - [3.5 复合断言 (all / any)](#35-复合断言-all--any)
- [4. Exec 输出断言 (expect.output)](#4-exec-输出断言-expectoutput)
- [5. Body 断言操作符详解](#5-body-断言操作符详解)
  - [5.1 基础操作符](#精确匹配)
  - [5.2 数组遍历断言 (every / some)](#every--some--数组遍历断言)
  - [5.3 否定断言 (not / notContains)](#not--否定包装器)
  - [5.4 响应时间断言 (responseTime)](#responsetime--响应时间断言)
- [6. 变量系统](#6-变量系统)
- [7. Setup 与 Teardown](#7-setup-与-teardown)
- [8. 完整示例](#8-完整示例)

---

## 1. 测试文件结构

一个 YAML 测试文件的顶层结构如下：

```yaml
name: 用户 API 测试
description: 测试用户注册、登录和查询接口
sequential: true

variables:
  baseUrl: "http://localhost:3000"
  testEmail: "test@example.com"

setup:
  - waitHealthy:
      timeout: "30s"
  - waitForPort:
      host: localhost
      port: 3000
      timeout: "10s"
  - delay: "2s"
  - name: 初始化测试数据
    request:
      method: POST
      path: /api/seed
    expect:
      status: 200

cases:
  - name: 测试用例 1
    # ... 步骤定义
  - name: 测试用例 2
    # ... 步骤定义

teardown:
  - name: 清理测试数据
    request:
      method: DELETE
      path: /api/cleanup
    ignoreError: true
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 测试套件名称 |
| `description` | string | ❌ | 测试套件描述 |
| `sequential` | boolean | ❌ | 是否顺序执行（默认 true） |
| `variables` | map | ❌ | 套件级变量定义 |
| `setup` | array | ❌ | 前置步骤，在所有用例前执行 |
| `cases` | array | ✅ | 测试用例列表 |
| `teardown` | array | ❌ | 清理步骤，在所有用例后执行 |

---

## 2. 测试步骤类型

每个测试步骤（case）可以是以下五种类型之一：

### 2.1 HTTP 请求步骤 (request)

发送 HTTP 请求并断言响应结果。

```yaml
- name: 获取用户列表
  request:
    method: GET
    path: /api/users
    headers:
      Authorization: "Bearer {{token}}"
    timeout: "10s"
  expect:
    status: 200
    body:
      users:
        length: { gt: 0 }
```

#### request 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `method` | string | ✅ | HTTP 方法：GET, POST, PUT, DELETE, PATCH 等 |
| `path` | string | ✅ | 请求路径（相对于 baseUrl） |
| `url` | string | ❌ | 完整 URL（优先于 baseUrl + path） |
| `headers` | map | ❌ | 请求头 |
| `body` | any | ❌ | 请求体（自动 JSON 序列化） |
| `timeout` | string | ❌ | 请求超时时间（默认 30s） |

**带请求体的 POST 示例：**

```yaml
- name: 创建用户
  request:
    method: POST
    path: /api/users
    headers:
      Content-Type: application/json
    body:
      name: "张三"
      email: "zhangsan@example.com"
      role: "admin"
  expect:
    status: 201
    body:
      id: { exists: true }
      name: "张三"
```

**使用完整 URL 的示例（跨服务调用）：**

```yaml
- name: 调用外部 API
  request:
    method: GET
    url: "http://mock-service:8080/api/external"
  expect:
    status: 200
```

---

### 2.2 容器命令执行步骤 (exec)

在 Docker 容器内执行命令，并可选地断言输出内容。这是最底层的执行工具，可以作为所有其他语义化步骤的兜底方案。

```yaml
- name: 检查容器内日志
  exec:
    command: "cat /var/log/app.log | tail -20"
    container: my-app  # 可选，默认使用配置中的容器名
  expect:
    exitCode: 0
    output:
      contains: "Server started"
      notContains: "ERROR"
```

#### exec 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | ✅ | 要在容器内执行的 shell 命令 |
| `container` | string | ❌ | 容器名（覆盖默认容器） |

---

### 2.3 文件断言步骤 (file)

语义化的文件检查工具。在容器内断言文件的存在性、内容、权限等属性。底层使用 `docker exec` 实现。

```yaml
- name: 检查配置文件
  file:
    path: /app/config.json
    exists: true
    contains: "database_url"
    json:
      database_url: { exists: true }
      port: { gt: 0 }
```

#### file 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | ✅ | 容器内文件路径 |
| `container` | string | ❌ | 覆盖默认容器名 |
| `exists` | boolean | ❌ | 断言文件是否存在 |
| `contains` | string / string[] | ❌ | 文件内容包含指定字符串 |
| `notContains` | string / string[] | ❌ | 文件内容不包含指定字符串 |
| `matches` | string | ❌ | 文件内容正则匹配 |
| `json` | map | ❌ | 将文件解析为 JSON 并用 body 断言引擎验证 |
| `permissions` | string | ❌ | 检查文件权限（如 `-rwxr-xr-x`） |
| `owner` | string | ❌ | 检查文件所有者 |
| `size` | string | ❌ | 检查文件大小（支持比较运算符） |

**完整文件断言示例：**

```yaml
# 检查文件存在且内容正确
- name: 验证 Nginx 配置
  file:
    path: /etc/nginx/nginx.conf
    exists: true
    contains:
      - "server_name"
      - "listen 80"
    notContains:
      - "debug"
    matches: "worker_processes\\s+\\d+"
    permissions: "-rw-r--r--"
    owner: "root"
    size: ">100"

# 检查 JSON 配置文件
- name: 验证应用配置
  file:
    path: /app/settings.json
    json:
      version: "2.0"
      database:
        host: { exists: true }
        port: { gte: 1024, lte: 65535 }
      features:
        length: { gt: 0 }

# 断言文件不存在
- name: 确认临时文件已清理
  file:
    path: /tmp/test-data.tmp
    exists: false
```

---

### 2.4 进程断言步骤 (process)

语义化的进程检查工具。在容器内断言进程运行状态、数量和运行用户。底层通过 `docker exec` 运行 `ps` 命令实现。

```yaml
- name: 检查 Nginx 主进程
  process:
    name: nginx
    running: true
    count: ">=1"
    user: root
```

#### process 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 进程名或匹配模式（用于 ps 输出中的 grep 匹配） |
| `container` | string | ❌ | 覆盖默认容器名 |
| `running` | boolean | ❌ | 断言进程是否在运行 |
| `count` | string | ❌ | 断言匹配进程数量（支持 `>0`, `==1`, `>=2`, `<5` 等） |
| `user` | string | ❌ | 断言进程运行用户 |

**进程断言示例：**

```yaml
# 断言进程正在运行
- name: Node.js 应用进程检查
  process:
    name: node
    running: true
    user: app

# 断言 Worker 进程数量
- name: 检查 Worker 进程数
  process:
    name: "worker"
    count: "==4"

# 断言进程不运行
- name: 确认旧进程已停止
  process:
    name: "old-service"
    running: false

# 在指定容器中检查进程
- name: 检查 Redis 进程
  process:
    name: redis-server
    container: redis-container
    running: true
    count: "==1"
```

---

### 2.5 端口断言步骤 (port)

语义化的端口监听检查工具。可以检查容器内部或宿主机上的端口。容器内通过 `docker exec` 使用 `ss`/`netstat` 检测，宿主机使用 TCP 连接探测。

```yaml
- name: 检查应用端口
  port:
    port: 3000
    listening: true
```

#### port 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `port` | number | ✅ | 要检查的端口号 |
| `host` | string | ❌ | 宿主机名（默认 localhost，容器模式下无效） |
| `container` | string | ❌ | 覆盖默认容器名（指定后在容器内检查） |
| `listening` | boolean | ❌ | 断言端口是否在监听（默认 true） |
| `timeout` | string | ❌ | 宿主机端口检查超时时间（默认 5s） |

**端口断言示例：**

```yaml
# 检查容器内端口
- name: 应用端口监听检查
  port:
    port: 8080
    listening: true

# 检查特定容器的端口
- name: 数据库端口检查
  port:
    port: 5432
    container: postgres-db
    listening: true

# 检查宿主机端口
- name: 检查代理端口（宿主机）
  port:
    port: 80
    host: localhost
    timeout: "3s"

# 确认端口未被占用
- name: 确认旧端口已释放
  port:
    port: 9090
    listening: false
```

---

## 3. HTTP 响应断言 (expect)

`expect` 块用于断言 HTTP 请求的响应。支持状态码、响应头、响应体、表达式和复合断言。

### 3.1 状态码断言 (status)

```yaml
# 精确匹配
expect:
  status: 200

# 多值匹配（任一满足即可）
expect:
  status: [200, 201]
```

### 3.2 响应头断言 (headers)

响应头比较不区分大小写。支持所有 body 断言操作符。

```yaml
expect:
  headers:
    content-type: "application/json; charset=utf-8"
    x-request-id: { exists: true }
    cache-control: { contains: "no-cache" }
```

### 3.3 响应体断言 (body)

响应体断言功能强大，支持精确匹配、操作符断言和嵌套对象递归。详见 [第 5 节](#5-body-断言操作符详解)。

```yaml
expect:
  body:
    success: true
    data:
      id: { type: "number", gt: 0 }
      name: "张三"
      email: { matches: "^[\\w.]+@[\\w.]+$" }
      roles: { length: { gte: 1 } }
      status: { in: ["active", "pending"] }
```

### 3.4 表达式断言 (expr)

简易 CEL 风格的表达式断言，适合编写简洁的复杂条件。

**语法支持：**
- 比较运算符：`==`, `!=`, `>`, `>=`, `<`, `<=`
- 逻辑运算符：`&&`（AND）, `||`（OR）
- 路径访问：`status`, `body.x.y`, `headers.content-type`, `body.items.length`
- 值类型：数字、字符串（引号包裹）、`true`, `false`, `null`

```yaml
# 单个表达式
expect:
  expr: "status == 200"

# 多个表达式（数组形式，全部需通过）
expect:
  expr:
    - "status == 200"
    - "body.count > 0"
    - "body.status == \"ok\""

# 复合表达式
expect:
  expr:
    - "body.score >= 60 && body.score <= 100"
    - "body.type == \"A\" || body.type == \"B\""
    - "body.items.length > 0"
    - "body.name != \"\""
```

**表达式路径说明：**

| 路径 | 说明 | 示例 |
|------|------|------|
| `status` | HTTP 状态码 | `status == 200` |
| `body` | 响应体根对象 | `body.name == "test"` |
| `body.x.y` | 嵌套字段 | `body.data.id > 0` |
| `body.items.length` | 数组/字符串长度 | `body.items.length >= 1` |
| `headers.x` | 响应头 | `headers.content-type == "application/json"` |

### 3.5 复合断言 (all / any)

将多个 body 断言条件组合使用。

**`all` — 全部满足（AND 逻辑）：**

```yaml
expect:
  all:
    - success: true
    - data:
        id: { exists: true }
    - data:
        status: { in: ["active", "pending"] }
```

**`any` — 任一满足（OR 逻辑）：**

```yaml
expect:
  any:
    - status_code: "SUCCESS"
    - error_code: 0
```

**混合使用：**

```yaml
expect:
  status: 200
  body:
    success: true
  all:
    - data:
        id: { gt: 0 }
    - data:
        name: { exists: true }
  expr: "body.data.score >= 60"
```

---

## 4. Exec 输出断言 (expect.output)

用于 `exec` 步骤的命令输出断言。

```yaml
- name: 检查日志内容
  exec:
    command: "cat /var/log/app.log"
  expect:
    exitCode: 0
    output:
      contains: "Server started"
      notContains: "FATAL"
      matches: "\\d{4}-\\d{2}-\\d{2}"
      length: ">10"          # 字符串比较
      # length: 1            # 精确行数
      # length: { gte: 1 }   # 对象比较
```

#### output 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `contains` | string / string[] | 输出包含指定字符串 |
| `notContains` | string / string[] | 输出不包含指定字符串 |
| `matches` | string | 正则匹配输出 |
| `json` | map | 将输出解析为 JSON，使用 body 断言引擎验证 |
| `length` | number / string / object | 输出行数断言。支持 `1`（精确）、`">10"` / `"==5"`、`{ gt: 0 }` / `{ gte: 1, lte: 10 }` / `{ eq: 1 }` / `{ n: 1 }` |

**Exec 输出解析为 JSON 的示例：**

```yaml
- name: 获取容器内 JSON 配置
  exec:
    command: "cat /app/status.json"
  expect:
    exitCode: 0
    output:
      json:
        status: "healthy"
        uptime: { gt: 0 }
        connections: { gte: 0 }
```

---

## 5. Body 断言操作符详解

body 断言引擎支持以下操作符，可用于 `expect.body`、`file.json`、`expect.output.json` 和 `expect.all`/`expect.any` 中。

### 精确匹配

直接给出值即为精确匹配（深度比较）。

```yaml
body:
  name: "张三"         # 字符串精确匹配
  age: 30              # 数字精确匹配
  active: true         # 布尔精确匹配
  deleted: null        # null 精确匹配
  tags: ["a", "b"]     # 数组精确匹配（顺序敏感）
```

### `type` — 类型检查

支持的类型：`string`, `number`, `boolean`, `object`, `array`, `null`

```yaml
body:
  name: { type: "string" }
  count: { type: "number" }
  enabled: { type: "boolean" }
  data: { type: "object" }
  items: { type: "array" }
  deleted_at: { type: "null" }
```

### `exists` — 存在性检查

```yaml
body:
  id: { exists: true }       # 字段必须存在且不为 null
  deprecated: { exists: false }  # 字段不存在或为 null
```

### `in` — 集合包含

```yaml
body:
  status: { in: ["active", "pending", "review"] }
  priority: { in: [1, 2, 3] }
```

### `gt` / `gte` / `lt` / `lte` — 数值比较

```yaml
body:
  count: { gt: 0 }       # 大于
  score: { gte: 60 }     # 大于等于
  errors: { lt: 5 }      # 小于
  latency: { lte: 1000 } # 小于等于
  # 可组合使用
  age: { gte: 18, lte: 120 }
```

### `contains` — 包含

```yaml
body:
  # 字符串包含
  message: { contains: "success" }
  # 数组包含指定元素
  tags: { contains: "important" }
```

### `matches` — 正则匹配

```yaml
body:
  email: { matches: "^[\\w.]+@[\\w.]+\\.\\w+$" }
  phone: { matches: "^1[3-9]\\d{9}$" }
  version: { matches: "^\\d+\\.\\d+\\.\\d+$" }
```

### `startsWith` — 前缀匹配

```yaml
body:
  url: { startsWith: "https://" }
  code: { startsWith: "ERR_" }
```

### `endsWith` — 后缀匹配

```yaml
body:
  filename: { endsWith: ".json" }
  path: { endsWith: "/" }
```

### `notContains` — 否定包含

```yaml
body:
  # 字符串不包含
  message: { notContains: "error" }
  # 数组不包含指定元素
  roles: { notContains: "banned" }
```

### `length` — 长度断言

```yaml
body:
  # 精确长度
  items: { length: 5 }
  # 比较运算
  results: { length: { gt: 0 } }
  users: { length: { gte: 1, lte: 100 } }
  # 适用于数组、字符串、对象键数量
  name: { length: { gte: 2 } }
```

### 嵌套对象断言

```yaml
body:
  data:
    user:
      id: { type: "number", gt: 0 }
      profile:
        avatar: { exists: true }
        bio: { type: "string" }
    meta:
      total: { gte: 0 }
      page: 1
```

### 组合操作符

同一字段可同时使用多个操作符：

```yaml
body:
  score:
    type: "number"
    gte: 0
    lte: 100
  name:
    type: "string"
    length: { gte: 1 }
    matches: "^[A-Za-z]"
```

### `every` / `some` — 数组遍历断言

对数组中的元素进行批量条件检查。

**`every` — 所有元素必须满足条件：**

```yaml
body:
  users:
    every:
      email: { exists: true, matches: "@" }
      name: { type: "string" }
      role: { in: ["admin", "user", "guest"] }
```

空数组对 `every` 视为通过（vacuous truth）。

**`some` — 至少一个元素满足条件：**

```yaml
body:
  users:
    some:
      role: "admin"
  scores:
    some:
      value: { gt: 90 }
```

空数组对 `some` 视为失败（无元素可匹配）。

### `not` — 否定包装器

对任意断言进行取反。内层断言通过时，`not` 使其失败；内层失败时，`not` 使其通过。

```yaml
body:
  # 值不等于
  status: { not: "error" }
  # 不在集合内
  code: { not: { in: [500, 502, 503] } }
  # 不匹配正则
  name: { not: { matches: "^test" } }
```

### `responseTime` — 响应时间断言

断言 HTTP 请求的响应时间（毫秒）。仅适用于 `request` 步骤。

```yaml
cases:
  - name: 健康检查响应快
    request:
      method: GET
      path: /health
    expect:
      status: 200
      responseTime: { lt: 200 }

  - name: 搜索接口性能
    request:
      method: GET
      path: /api/search?q=test
    expect:
      status: 200
      responseTime: { lt: 2000 }

  - name: 简写形式（最大耗时）
    request:
      method: GET
      path: /api/fast
    expect:
      responseTime: 500
```

`responseTime` 支持操作符：`lt`、`lte`、`gt`、`gte`。纯数字等价于 `{ lt: N }`，表示不超过 N 毫秒。

---

## 6. 变量系统

### 定义变量

```yaml
variables:
  apiBase: "http://localhost:3000"
  adminEmail: "admin@test.com"
  testPassword: "Test123!"
```

### 使用变量

用 `{{变量名}}` 引用：

```yaml
cases:
  - name: 管理员登录
    request:
      method: POST
      path: /api/login
      body:
        email: "{{adminEmail}}"
        password: "{{testPassword}}"
    expect:
      status: 200
```

### 从响应中保存变量

使用 `save` 从响应中提取值保存为变量，供后续步骤使用：

```yaml
cases:
  - name: 登录获取 Token
    request:
      method: POST
      path: /api/login
      body:
        email: "{{adminEmail}}"
        password: "{{testPassword}}"
    expect:
      status: 200
      body:
        token: { exists: true }
    save:
      token: "token"         # 保存 body.token 到变量 token
      userId: "user.id"      # 保存 body.user.id 到变量 userId

  - name: 获取用户信息
    request:
      method: GET
      path: "/api/users/{{userId}}"
      headers:
        Authorization: "Bearer {{token}}"
    expect:
      status: 200
```

---

## 7. Setup 与 Teardown

### Setup 步骤

在所有测试用例执行前运行。支持特殊步骤类型：

```yaml
setup:
  # 等待服务健康检查通过
  - waitHealthy:
      timeout: "60s"

  # 等待端口可用
  - waitForPort:
      host: localhost
      port: 5432
      timeout: "30s"

  # 简单延迟
  - delay: "3s"

  # 常规测试步骤（执行初始化操作）
  - name: 初始化数据库
    exec:
      command: "npm run db:seed"
    ignoreError: true  # 忽略错误继续执行
```

### Teardown 步骤

在所有测试用例执行后运行：

```yaml
teardown:
  - name: 清理测试数据
    request:
      method: DELETE
      path: /api/test/cleanup
    ignoreError: true  # 清理步骤通常应忽略错误

  - name: 重置数据库
    exec:
      command: "npm run db:reset"
    ignoreError: true
```

---

## 8. 完整示例

### 示例 1：Web 应用 API 测试

```yaml
name: 用户管理 API 测试
description: 完整的用户 CRUD 接口测试
sequential: true

variables:
  testEmail: "e2e-test@example.com"
  testPassword: "SecurePass123!"

setup:
  - waitHealthy:
      timeout: "30s"
  - name: 清理旧测试数据
    request:
      method: DELETE
      path: /api/test/cleanup
    ignoreError: true

cases:
  - name: 注册新用户
    request:
      method: POST
      path: /api/auth/register
      body:
        email: "{{testEmail}}"
        password: "{{testPassword}}"
        name: "E2E 测试用户"
    expect:
      status: 201
      body:
        success: true
        user:
          id: { type: "number", gt: 0 }
          email: "{{testEmail}}"
          name: "E2E 测试用户"
    save:
      userId: "user.id"

  - name: 登录获取 Token
    request:
      method: POST
      path: /api/auth/login
      body:
        email: "{{testEmail}}"
        password: "{{testPassword}}"
    expect:
      status: 200
      body:
        token: { type: "string", length: { gt: 10 } }
      expr: "body.expiresIn > 0"
    save:
      token: "token"

  - name: 获取当前用户信息
    request:
      method: GET
      path: "/api/users/{{userId}}"
      headers:
        Authorization: "Bearer {{token}}"
    expect:
      status: 200
      headers:
        content-type: { contains: "application/json" }
      body:
        id: { type: "number" }
        email: "{{testEmail}}"
        createdAt: { exists: true }

  - name: 更新用户名
    request:
      method: PUT
      path: "/api/users/{{userId}}"
      headers:
        Authorization: "Bearer {{token}}"
      body:
        name: "更新后的名字"
    expect:
      status: 200
      body:
        name: "更新后的名字"

  - name: 用户列表接口
    request:
      method: GET
      path: /api/users
      headers:
        Authorization: "Bearer {{token}}"
    expect:
      status: 200
      body:
        users: { length: { gt: 0 } }
        total: { gte: 1 }

  - name: 删除测试用户
    request:
      method: DELETE
      path: "/api/users/{{userId}}"
      headers:
        Authorization: "Bearer {{token}}"
    expect:
      status: [200, 204]

teardown:
  - name: 最终清理
    request:
      method: DELETE
      path: /api/test/cleanup
    ignoreError: true
```

### 示例 2：容器环境检查

```yaml
name: 容器环境验收测试
description: 验证容器内部署后的运行环境是否正确

cases:
  # —— 文件检查 ——
  - name: 应用配置文件就绪
    file:
      path: /app/config/production.json
      exists: true
      json:
        env: "production"
        log_level: { in: ["info", "warn"] }
        database:
          host: { exists: true }
          port: 5432

  - name: SSL 证书存在
    file:
      path: /etc/ssl/certs/app.crt
      exists: true
      permissions: "-rw-r--r--"
      size: ">500"

  - name: 日志目录可写
    file:
      path: /var/log/app/access.log
      exists: true
      owner: "app"

  - name: 临时文件已清理
    file:
      path: /tmp/build-cache
      exists: false

  # —— 进程检查 ——
  - name: Node.js 应用运行中
    process:
      name: node
      running: true
      count: ">=1"

  - name: Nginx 反向代理运行中
    process:
      name: nginx
      running: true
      count: ">=2"
      user: root

  - name: Cron 调度器运行
    process:
      name: cron
      running: true

  - name: 旧版服务已停止
    process:
      name: legacy-service
      running: false

  # —— 端口检查 ——
  - name: 应用端口监听
    port:
      port: 3000
      listening: true

  - name: 管理端口监听
    port:
      port: 9090
      listening: true

  - name: Debug 端口未开启
    port:
      port: 9229
      listening: false

  # —— 命令执行兜底 ——
  - name: 检查 Node.js 版本
    exec:
      command: "node --version"
    expect:
      exitCode: 0
      output:
        matches: "^v\\d+\\.\\d+\\.\\d+"
        contains: "v22"

  - name: 检查磁盘使用率
    exec:
      command: "df -h / | tail -1 | awk '{print $5}' | sed 's/%//'"
    expect:
      exitCode: 0
      output:
        # 输出为数字字符串，使用正则确认在合理范围
        matches: "^\\d+$"
```

### 示例 3：复合断言与表达式

```yaml
name: 高级断言示例
description: 展示 expr、all、any 复合断言的用法

cases:
  - name: 搜索接口 - 复合条件验证
    request:
      method: GET
      path: /api/search?q=test&page=1&limit=20
    expect:
      status: 200
      # 基础断言
      body:
        success: true
        data:
          items: { type: "array", length: { gt: 0 } }
      # 表达式断言
      expr:
        - "body.data.total >= 0"
        - "body.data.page == 1"
        - "body.data.items.length <= 20"
      # AND 复合断言：所有条件必须满足
      all:
        - data:
            items: { length: { gt: 0, lte: 20 } }
        - data:
            hasMore: { type: "boolean" }

  - name: 多状态接口 - OR 条件
    request:
      method: GET
      path: /api/tasks/123
    expect:
      # OR 复合断言：满足任一条件即可
      any:
        - status: "completed"
        - status: "in_progress"
        - status: "pending"

  - name: 范围与逻辑组合
    request:
      method: GET
      path: /api/metrics
    expect:
      expr:
        - "body.cpu_usage >= 0 && body.cpu_usage <= 100"
        - "body.memory_usage >= 0 && body.memory_usage <= 100"
        - "body.status == \"healthy\" || body.status == \"degraded\""
      body:
        uptime: { type: "number", gt: 0 }
        version: { matches: "^\\d+\\.\\d+\\.\\d+$" }
```

### 示例 4：数据库与服务联调

```yaml
name: 数据库服务联调测试
description: 验证应用与数据库的连接与数据一致性

setup:
  - waitForPort:
      host: localhost
      port: 5432
      timeout: "30s"
  - waitHealthy:
      timeout: "30s"
  - name: 执行数据库迁移
    exec:
      command: "npm run db:migrate"
    expect:
      exitCode: 0

cases:
  - name: 数据库连接正常
    exec:
      command: "pg_isready -h localhost -p 5432"
      container: postgres-db
    expect:
      exitCode: 0
      output:
        contains: "accepting connections"

  - name: 表结构已创建
    exec:
      command: "psql -U app -d testdb -c '\\dt' | grep users"
      container: postgres-db
    expect:
      exitCode: 0
      output:
        contains: "users"

  - name: 创建数据并验证持久化
    request:
      method: POST
      path: /api/items
      body:
        name: "持久化测试"
        value: 42
    expect:
      status: 201
    save:
      itemId: "id"

  - name: 直接查询数据库验证
    exec:
      command: "psql -U app -d testdb -c \"SELECT name, value FROM items WHERE id = {{itemId}}\" -t"
      container: postgres-db
    expect:
      exitCode: 0
      output:
        contains:
          - "持久化测试"
          - "42"

teardown:
  - name: 清理测试数据
    exec:
      command: "psql -U app -d testdb -c \"DELETE FROM items WHERE name = '持久化测试'\""
      container: postgres-db
    ignoreError: true
```

---

## 附录 A：时间格式

测试配置中所有时间字段（`delay`, `timeout` 等）支持以下格式：

| 格式 | 示例 | 含义 |
|------|------|------|
| `Ns` | `"5s"` | 5 秒 |
| `Nms` | `"500ms"` | 500 毫秒 |
| `Nm` | `"2m"` | 2 分钟 |
| `Nh` | `"1h"` | 1 小时 |
| `N` | `"5000"` | 5000 毫秒 |

## 附录 B：比较运算符（用于 count / size / length）

以下形式可用于 `process.count`、`file.size`、`expect.output.length`：

**字符串运算符：**

| 运算符 | 示例 | 含义 |
|--------|------|------|
| `>` | `">0"` | 大于 |
| `<` | `"<100"` | 小于 |
| `>=` | `">=1"` | 大于等于 |
| `<=` | `"<=50"` | 小于等于 |
| `==` | `"==1"` | 等于 |
| `!=` | `"!=0"` | 不等于 |

**`expect.output.length` 额外支持：**

| 形式 | 示例 | 含义 |
|------|------|------|
| number | `length: 1` | 精确行数 |
| object | `length: { gt: 0 }` | `gt` / `gte` / `lt` / `lte` / `eq` / `n` |

## 附录 C：步骤通用字段

以下字段适用于所有步骤类型：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 步骤名称（必填） |
| `delay` | string | 执行前等待时间 |
| `save` | map | 保存响应变量（仅 request 步骤） |
| `ignoreError` | boolean | 忽略错误继续执行 |
| `retry` | object | 步骤级别重试策略（覆盖 suite 和全局策略） |

## 附录 D：重试策略 (retry)

测试步骤、Suite 和全局级别均可配置重试策略，优先级为：步骤 > Suite > 全局。

```yaml
retry:
  maxAttempts: 3        # 最大重试次数（含首次，1-10）
  delay: "2s"           # 重试间隔
  backoff: exponential  # 退避策略：linear 或 exponential（可选）
  backoffMultiplier: 2  # 退避乘数（可选，默认 2）
```

### 全局配置（e2e.yaml）

```yaml
tests:
  retry:
    maxAttempts: 2
    delay: "1s"
  suites:
    - name: 健康检查
      id: health
      file: tests/health.yaml
```

### Suite 级别（e2e.yaml suite 配置）

```yaml
tests:
  suites:
    - name: 不稳定测试
      id: flaky
      file: tests/flaky.yaml
      retry:
        maxAttempts: 3
        delay: "2s"
        backoff: exponential
```

### 步骤级别（YAML 测试文件）

```yaml
cases:
  - name: 重试请求
    request:
      method: GET
      path: /api/health
    expect:
      status: 200
    retry:
      maxAttempts: 5
      delay: "500ms"
      backoff: linear
```
