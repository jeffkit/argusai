---
"argusai-core": patch
"argusai-mcp": patch
---

fix run UX and output.length assertion (issues #5, #6, #7)

- **#7**: `expect.output.length` now supports number (`1`), string (`">0"`), and object (`{ gte: 1 }` / `{ eq: 1 }`) without throwing `match is not a function`
- **#5**: `argus_run` / `argus_run_suite` auto-start missing service/mock containers via setup instead of per-case "No such container" failures
- **#6**: failed runs return `exitCode: 1` and MCP `isError: true` for CI-friendly failure detection
