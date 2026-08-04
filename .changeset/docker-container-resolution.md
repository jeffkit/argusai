---
"argusai-core": patch
"argusai-mcp": patch
"argusai-core-storage": patch
"argusai-dashboard": patch
---

Fix Docker-mode e2e: resolve namespace-prefixed container names in steps

0.15.x prefixes containers with the isolation namespace (`wt-XXX-recursive-e2e`)
but exec/file/process/port steps still used the raw YAML name
(`recursive-e2e`), so `docker exec recursive-e2e` failed with
"No such container" whenever WORKTREE_ID was set.

- `executeExecStep` / `executeFileStep` / `executeProcessStep` /
  `executePortStep`: the session-resolved `containerName` (injected via
  options) now takes priority over the raw `step.container` — mirrors the
  container naming change. HostRuntime ignores the name, so host mode is
  unaffected.
- Plugin steps (e.g. `recursive-session`'s docker cp): the step body's
  `container` field is overridden with the resolved name before dispatch,
  so container-side assertions reach the right container.

Verified: Docker-mode e2e suites pass again (smoke/basic/session/memory/
cost/export/http-api/http-auth/http-interrupt/http-rate-limit/goal-loop/
bash-tool/glob-tool/utility-tools/sandbox-security/session-rewind/
compaction/python-sdk/typescript-sdk — 20 suites); host mode stays 39/41.
