---
"argusai-core": minor
"argusai-mcp": minor
"argusai-dashboard": patch
"argusai-core-storage": patch
---

HostRuntime: run e2e suites on the host without Docker containers

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
