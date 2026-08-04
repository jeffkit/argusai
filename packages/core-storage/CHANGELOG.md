# argusai-core-storage

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
