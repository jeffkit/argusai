# 文档-代码映射表

| 文档路径 | 代码路径模式 | 说明 |
|----------|-------------|------|
| `README.md` | `packages/cli/src/**`, `packages/core/src/**`, `packages/mcp/src/**`, `packages/dashboard/src/**` | 项目总览文档 |
| `docs/ONBOARDING.md` | `packages/cli/src/commands/**`, `packages/core/src/config-loader.ts` | 业务接入指南 |
| `docs/yaml-test-config.md` | `packages/core/src/types.ts`, `packages/core/src/yaml-engine.ts`, `packages/core/src/assertion-engine.ts` | YAML 测试配置参考文档 |
| `ci-templates/gitlab-ci.yml` | `packages/cli/src/commands/**` | GitLab CI 模板 |
| `ci-templates/github-actions.yml` | `packages/cli/src/commands/**` | GitHub Actions 模板 |
| `mcp-templates/cursor-mcp-config.json` | `packages/mcp/src/server.ts` | MCP 配置模板 |
| `specs/003-resilience/spec.md` | `packages/core/src/resilience/**` | 韧性与自愈功能规格 |
| `specs/003-resilience/plan.md` | `packages/core/src/resilience/**`, `packages/mcp/src/tools/preflight-check.ts`, `packages/mcp/src/tools/reset-circuit.ts` | 韧性功能实现计划 |
| `specs/003-resilience/tasks.md` | `packages/core/src/resilience/**`, `packages/mcp/src/**` | 韧性功能任务清单 |
| `specs/005-diagnostics/spec.md` | `packages/core/src/knowledge/**` | 智能诊断建议功能规格 |
| `specs/005-diagnostics/plan.md` | `packages/core/src/knowledge/**`, `packages/mcp/src/tools/diagnose.ts`, `packages/mcp/src/tools/report-fix.ts`, `packages/mcp/src/tools/patterns.ts` | 智能诊断建议实现计划 |
| `specs/005-diagnostics/data-model.md` | `packages/core/src/knowledge/types.ts`, `packages/core/src/knowledge/knowledge-store.ts`, `packages/core/src/history/migrations.ts` | 诊断知识库数据模型 |
| `specs/004-history/spec.md` | `packages/core/src/history/**` | 测试持久化与趋势分析功能规格 |
| `specs/004-history/plan.md` | `packages/core/src/history/**`, `packages/mcp/src/tools/history.ts`, `packages/mcp/src/tools/trends.ts`, `packages/dashboard/src/pages/Trends.tsx` | 测试持久化实现计划 |
| `specs/004-history/tasks.md` | `packages/core/src/history/**`, `packages/mcp/src/**`, `packages/dashboard/**` | 测试持久化任务清单 |
| `specs/005-diagnostics/tasks.md` | `packages/core/src/knowledge/**`, `packages/mcp/src/**` | 智能诊断建议任务清单 |
| `specs/006-openapi-mock/spec.md` | `packages/core/src/openapi/**` | OpenAPI 智能 Mock 功能规格 |
| `specs/006-openapi-mock/plan.md` | `packages/core/src/openapi/**`, `packages/core/src/mock-generator.ts`, `packages/mcp/src/tools/mock-generate.ts`, `packages/mcp/src/tools/mock-validate.ts` | OpenAPI Mock 实现计划 |
| `specs/006-openapi-mock/tasks.md` | `packages/core/src/openapi/**`, `packages/core/src/mock-generator.ts`, `packages/mcp/src/**` | OpenAPI Mock 任务清单 |
| `README.md` | `packages/core/src/port-allocator.ts`, `packages/mcp/src/tools/resources.ts`, `packages/mcp/src/session.ts`, `packages/core/src/types.ts`, `packages/core/src/config-loader.ts` | 多项目隔离功能文档（README 多项目隔离章节） |
| `docs/ONBOARDING.md` | `packages/core/src/port-allocator.ts`, `packages/mcp/src/tools/resources.ts`, `packages/mcp/src/session.ts` | 业务接入指南（多项目隔离 Q&A 章节） |
| `argusai-marketplace/argusai/skills/argusai-e2e/SKILL.md` | `packages/mcp/src/tools/resources.ts`, `packages/mcp/src/session.ts` | argusai-e2e 运行技能（多项目隔离与纯测试模式章节） |
| `argusai-marketplace/argusai/skills/argusai-author/SKILL.md` | `packages/core/src/config-loader.ts`, `packages/core/src/types.ts` | argusai-author 配置创作技能（isolation/test-only 配置选项） |
| `specs/003-evolution-roadmap/roadmap.md` | `packages/core/src/**`, `packages/mcp/src/**`, `packages/dashboard/**` | ArgusAI 进化路线图 |
| `argusai-marketplace/argusai/skills/argusai-e2e/SKILL.md` | `packages/core/src/browser-executor.ts`, `packages/core/src/yaml-engine.ts`, `packages/core/src/types.ts` | argusai-e2e 运行技能（browser DSL 章节） |
|| `docs/plugin-development.md` | `packages/core/src/plugin-loader.ts`, `packages/core/src/types.ts`, `packages/core/src/assertion-plugin-registry.ts`, `packages/cli/src/commands/run.ts`, `packages/mcp/src/tools/init.ts` | 插件开发指南 |
