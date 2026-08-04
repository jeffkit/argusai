# argusai-core-storage

## 0.15.4

### Patch Changes

- 9a8aa8c: Fix Docker-mode e2e: resolve namespace-prefixed container names in steps

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

## 0.15.3

### Patch Changes

- e6412aa: HostRuntime: run exec commands with cwd = workspaceDir (mirror Docker WORKDIR)

  HostRuntime.execInContainer now sets `cwd: workspaceDir` when a workspace
  dir is configured. Without this, host-mode processes inherited the
  daemon's cwd, so commands relying on relative paths — or binaries that
  default their workspace to cwd (e.g. `recursive http` with no
  `--workspace`) — resolved files outside the mapped workspace, diverging
  from Docker mode (where `docker exec` uses the image WORKDIR=/workspace).

  Fixes recursive's host-mode e2e suites where the agent wrote files to
  the daemon cwd instead of the workspace (e.g. 08-http-api's
  "POST /run wrote http-run.txt" assertion).

## 0.15.0

### Patch Changes

- b9df8c4: HostRuntime: run e2e suites on the host without Docker containers

  New `runtime: { type: host }` config option that executes test commands
  directly on the host machine — no Docker image builds, no service containers,
  no Docker networks. Test commands (exec/file/process/port steps) route through
  a `HostRuntime` that ignores container names and runs via `sh -c` on the host.

  **Breaking change (interface):** `ContainerRuntime.execInContainer` now returns
  `RuntimeExecResult { stdout, exitCode }` instead of `Promise<string>`. This
  type was already declared but unused; the upgrade surfaces the exitCode that
  yaml-engine needs for `expect.exitCode` assertions. `DockerRuntime`,
  `KubernetesRuntime`, and `HostRuntime` all implement the new signature.

  **Key changes:**

  - `runtime.ts`: new `HostRuntime` class; `RuntimeType` adds `'host'`;
    `createRuntime({ type: 'host' })` returns it. Container lifecycle methods
    (build/start/network/health) are no-ops in host mode.
  - `yaml-engine.ts`: `YAMLEngineOptions` gains optional `runtime`; when injected,
    exec/file/process/port steps route through `runtime.execInContainer` instead
    of hardcoded `docker exec`. Legacy fallback preserved (no runtime = docker).
  - `docker-engine.ts`: `execInContainer` returns `{ stdout, exitCode }` instead
    of throwing on non-zero exit (callers decide handling).
  - `config-loader.ts`: `runtime` field added to zod schema (was being stripped).
  - `types.ts`: `E2EConfig.runtime` added; `ServiceConfig.build` and
    `ServiceDefinition.build` become optional (host mode builds no image).
  - `session.ts`: session holds a `ContainerRuntime` instance from `createRuntime`.
  - `run.ts`: injects `session.runtime` into `executeYAMLSuite`.
  - `setup.ts`: host-mode services (no build config) skip container startup.
  - `index.ts` (mcp): `isMainModule` detection is now symlink-aware (realpathSync)
    so `npm link` works for local development.
  - `index.ts` (core): `HostRuntime` re-exported for consumers.

  Fulfills the F08 TODO in setup.ts (wire ContainerRuntime through the execution
  path instead of bypassing it with direct docker-engine calls).

## 0.14.3

### Patch Changes

- 2eb6b59: Version bump to keep linked packages in sync with argusai-core@0.14.3 (issue #9 release).

## 0.14.2

### Patch Changes

- 442e362: Version bump to keep linked packages in sync with argusai-core@0.14.2 (issue #8 release).

## 0.14.1

### Patch Changes

- bca4ec3: Version bump to keep linked packages in sync with argusai-core@0.14.1 (issues #5/#6/#7 release).

## 0.14.0

### Minor Changes

- ## v0.13.0 — Storage extraction, async mutex, AI UX fixes

  ### New Package: `argusai-core-storage`

  Extracted the history/knowledge/db/sync storage layer from `argusai-core` into a dedicated
  `argusai-core-storage` package using the Strangler Fig pattern. `argusai-core` re-exports
  everything for full backward compatibility — no consumer changes required.

  ### Breaking / Structural Changes (argusai-mcp)

  - **Async session mutex**: replaced the synchronous fake-lock `SessionMutex` with a true async
    `AsyncSessionMutex` using `async-mutex`. Concurrent tool calls on the same project are now
    correctly serialised across `await` boundaries. The old `acquireLock`/`releaseLock` pair is
    replaced by the safer `withLock(key, fn)` API.
  - **runId collision fix**: `runId` now uses `randomUUID()` instead of `Date.now().toString(36)`,
    eliminating collision risk under high-concurrency or fast-clock environments.

  ### Bug Fixes

  - **Suite duration was always ~0ms**: YAML suite duration is now read from the engine-emitted
    `suite_end.duration` field instead of being measured after all events are collected.
  - **Registry re-created per external suite**: `RunnerRegistry` is now created once outside the
    loop instead of once per external suite (vitest/pytest/playwright/etc.).
  - **Removed dangerous `cwd()` fallback**: `resolveProjectPath` no longer falls back to
    `process.cwd()`, which caused silent test failures when MCP was invoked from a different
    working directory than the project root.

  ### AI UX Improvements

  - **`sessionState` in every response**: all lifecycle tools (init/build/setup/run/run_suite/
    status/logs/clean/rebuild/dev) now include a `sessionState` field (`"initialized"` |
    `"built"` | `"running"` | `"stopped"` | `"none"`) so AI agents always know the current
    environment phase without an extra `argus_status` call.
  - **Output size control**: `argus_run` and `argus_run_suite` gain a `maxFailures` parameter
    (default 20) that limits failed test cases in the response to prevent context overflow.
    The full untruncated data is still persisted to history. A `truncated: true` flag and
    `totalFailedCases` count are included when clipping occurs.
  - **History write warnings**: history persistence failures are now surfaced as `warnings[]`
    in the response instead of being silently discarded, including actionable guidance for
    critical DB errors.
