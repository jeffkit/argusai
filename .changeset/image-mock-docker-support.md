---
"argusai-core": patch
"argusai-mcp": patch
---

feat(mcp): support image-based mocks as Docker containers in argus-setup

- `MockServiceConfig` gains `volumes` and `args` fields (types.ts, config-loader.ts)
- `argus-setup` MCP tool now starts image-based mocks (e.g. aimock) as Docker
  containers joined to the session's isolation network, instead of skipping them
- Volume paths relative to projectPath are resolved to absolute paths before
  passing to `docker run`, so `./fixtures:/fixtures` works correctly
- Stale containers with the same name are removed before starting fresh
