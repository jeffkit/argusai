# argusai-mcp

## 0.5.1

### Patch Changes

- fix: resolve 9 issues from E2E testing feedback

  Bug fixes:

  - Fix docker build path resolution — build paths now resolved to absolute paths relative to e2e.yaml
  - Fix healthcheck hardcoded port 80 — auto-detects container port, supports explicit `port` field
  - Add `useExisting` param to skip build when image already exists
  - Include build output logs in error messages on failure

  Design improvements:

  - Enable test-only mode (run tests without services in initialized state)
  - Support docker-compose style object format for `services` config
  - Clean residual containers by Docker label in argus_clean

  New features:

  - Add `argus_rebuild` tool for one-step clean → init → build → setup

- Updated dependencies
  - argusai-core@0.5.1

## 0.5.0

### Minor Changes

- feat: add Error Recovery & Self-Healing resilience subsystem

  - 7 resilience modules: error-codes, preflight, container-guardian, port-resolver, orphan-cleaner, circuit-breaker, network-verifier
  - 13 structured error codes for AI-parseable diagnostics
  - 2 new MCP tools: argus_preflight_check, argus_reset_circuit (9→11 tools)
  - Resilience config section in e2e.yaml schema
  - 141 unit tests across 15 test files

### Patch Changes

- Updated dependencies
  - argusai-core@0.2.0
