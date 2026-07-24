# AGENTS.md — ArgusAI

> 配置驱动的 Docker 容器 E2E 测试平台；内置 MCP，供 AI 助手直接跑测试。
> 负责人：jeffkit | 创建：2026-02-12

## 项目概述

ArgusAI 用 YAML（`e2e.yaml`）声明测试环境、Mock 与用例，自动完成镜像构建、容器编排、断言与清理。  
面向服务端 API / 微服务联调 / CI 验收；通过 `argusai-mcp` 暴露工具给 Cursor / Claude Code。  
本仓是 pnpm monorepo，核心逻辑在 `packages/core`，MCP / Dashboard / Server 分包装。

**技术栈：** TypeScript, Node.js ≥20, pnpm, Docker, Vitest, Playwright, Fastify, MCP  
**主仓库：** `git@github.com:jeffkit/argusai.git`

## 架构地图

流水线：`config-loader` → Docker 编排 → runners / assertion → reporter / history。  
MCP 与 Dashboard 调用同一套 core；Server 负责团队级结果汇聚与同步。

关键目录：
- `packages/core/src/` — 引擎核心（docker-engine、orchestrator、runners、assertion、openapi mock）
- `packages/core-storage/src/` — SQLite/Drizzle 历史与知识库
- `packages/mcp/src/` — MCP Server（`argusai-mcp` CLI）
- `packages/dashboard/` — 实时监控 UI（`server/` + `ui/`）
- `packages/server/src/` — 集中式服务层（Fastify）
- `schemas/` — JSON Schema（e2e-config / test-suite）
- `examples/` — 示例项目（含 `as-mate/e2e.yaml`）
- `docs/` — 接入与插件开发文档
- `specs/` — Speckit 规格与契约

## 开发约定

**分支策略：** `develop` 开发，`release/test` 测试，`main` 生产；PR 合并。  
**版本发布：** Changesets（`pnpm changeset` → `version-packages` → `release`）。

**禁止事项：**
- 禁止在未跑过相关包测试的情况下改 `packages/core` 的编排/断言逻辑
- 禁止手改 `schemas/*.json` 而不同步 `packages/core` 的 schema 生成流程
- 禁止把业务项目的 `e2e.yaml` 提交进本仓（放 `examples/` 或业务仓）
- 禁止绕过 pnpm workspace 用绝对路径引用兄弟包

## 常用命令

```bash
pnpm install                 # 安装依赖
pnpm build                   # 构建全部包
pnpm test                    # 跑 argusai* 包测试（watch）
pnpm test:run                # CI 用单次测试
pnpm type-check              # tsc -b
pnpm --filter argusai-mcp build   # 只构建 MCP
pnpm --filter argusai-server dev  # 启动 server
pnpm dev                     # Dashboard（默认 examples/as-mate）
```

## 当前状态

**当前里程碑：** {待人工填写}

## 深入阅读

| 文档 | 说明 |
|------|------|
| `README.md` | 产品说明与快速开始 |
| `docs/ONBOARDING.md` | 业务团队接入指南 |
| `docs/yaml-test-config.md` | e2e.yaml 配置说明 |
| `docs/plugin-development.md` | 断言插件开发 |
| `docs/DOC_CODE_MAP.md` | 文档-代码映射 |
| `argusai-marketplace`（兄弟仓） | Claude Code Plugin 分发 |
