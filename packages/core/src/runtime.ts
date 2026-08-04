/**
 * @module runtime
 * Abstract container runtime interface.
 *
 * Provides a unified API for running containers regardless of the
 * underlying backend (Docker CLI, Kubernetes, etc.).
 *
 * - DockerRuntime: wraps the existing docker-engine functions (default)
 * - KubernetesRuntime: creates ephemeral Pods/Jobs (requires kubectl)
 *
 * Local mode always uses DockerRuntime. The runtime is selected via
 * configuration and is fully transparent to callers.
 */

import type { BuildEvent, ContainerStatus } from './types.js';

// =====================================================================
// Types
// =====================================================================

export interface RuntimeBuildOptions {
  dockerfile: string;
  context: string;
  imageName: string;
  buildArgs?: Record<string, string>;
  noCache?: boolean;
}

export interface RuntimeRunOptions {
  name: string;
  image: string;
  ports: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  network?: string;
  healthcheck?: {
    cmd: string;
    interval: string;
    timeout: string;
    retries: number;
    startPeriod: string;
  };
  /** CPU limit (Docker: --cpus, K8s: resources.limits.cpu) */
  cpuLimit?: number;
  /** Memory limit, e.g. "512m" (Docker: --memory, K8s: resources.limits.memory) */
  memoryLimit?: string;
}

export interface RuntimeExecResult {
  stdout: string;
  exitCode: number;
}

// =====================================================================
// Runtime Interface
// =====================================================================

export interface ContainerRuntime {
  readonly name: string;

  buildImage(options: RuntimeBuildOptions): AsyncGenerator<BuildEvent>;

  startContainer(options: RuntimeRunOptions): Promise<string>;
  stopContainer(name: string): Promise<void>;
  getContainerStatus(name: string): Promise<ContainerStatus>;
  isContainerRunning(name: string): Promise<boolean>;
  getContainerLogs(name: string, lines?: number): Promise<string>;
  execInContainer(name: string, command: string): Promise<RuntimeExecResult>;

  ensureNetwork(name: string): Promise<void>;
  removeNetwork(name: string): Promise<void>;

  waitForHealthy(name: string, timeoutMs?: number): Promise<boolean>;
}

// =====================================================================
// DockerRuntime — wraps docker-engine.ts
// =====================================================================

export class DockerRuntime implements ContainerRuntime {
  readonly name = 'docker';

  async *buildImage(options: RuntimeBuildOptions): AsyncGenerator<BuildEvent> {
    const { buildImage } = await import('./docker-engine.js');
    yield* buildImage(options);
  }

  async startContainer(options: RuntimeRunOptions): Promise<string> {
    const { startContainer, buildRunArgs } = await import('./docker-engine.js');
    const dockerOpts = {
      ...options,
      cpuLimit: undefined,
      memoryLimit: undefined,
    };
    return startContainer(dockerOpts);
  }

  async stopContainer(name: string): Promise<void> {
    const { stopContainer } = await import('./docker-engine.js');
    return stopContainer(name);
  }

  async getContainerStatus(name: string): Promise<ContainerStatus> {
    const { getContainerStatus } = await import('./docker-engine.js');
    return getContainerStatus(name);
  }

  async isContainerRunning(name: string): Promise<boolean> {
    const { isContainerRunning } = await import('./docker-engine.js');
    return isContainerRunning(name);
  }

  async getContainerLogs(name: string, lines = 100): Promise<string> {
    const { getContainerLogs } = await import('./docker-engine.js');
    return getContainerLogs(name, lines);
  }

  async execInContainer(name: string, command: string): Promise<RuntimeExecResult> {
    const { execInContainer } = await import('./docker-engine.js');
    return execInContainer(name, command);
  }

  async ensureNetwork(name: string): Promise<void> {
    const { ensureNetwork } = await import('./docker-engine.js');
    return ensureNetwork(name);
  }

  async removeNetwork(name: string): Promise<void> {
    const { removeNetwork } = await import('./docker-engine.js');
    return removeNetwork(name);
  }

  async waitForHealthy(name: string, timeoutMs = 120_000): Promise<boolean> {
    const { waitForHealthy } = await import('./docker-engine.js');
    return waitForHealthy(name, timeoutMs);
  }
}

// =====================================================================
// KubernetesRuntime — creates ephemeral Pods via kubectl
// =====================================================================

export interface K8sRuntimeOptions {
  namespace?: string;
  kubeconfig?: string;
  /** Image pull secret name for private registries. */
  imagePullSecret?: string;
  /** Node selector labels. */
  nodeSelector?: Record<string, string>;
}

export class KubernetesRuntime implements ContainerRuntime {
  readonly name = 'kubernetes';
  private readonly namespace: string;
  private readonly kubeconfig?: string;
  private readonly imagePullSecret?: string;
  private readonly nodeSelector?: Record<string, string>;

  constructor(options?: K8sRuntimeOptions) {
    this.namespace = options?.namespace ?? 'preflight';
    this.kubeconfig = options?.kubeconfig;
    this.imagePullSecret = options?.imagePullSecret;
    this.nodeSelector = options?.nodeSelector;
  }

  private kubectlArgs(): string[] {
    const args: string[] = [];
    if (this.kubeconfig) args.push('--kubeconfig', this.kubeconfig);
    args.push('-n', this.namespace);
    return args;
  }

  private async kubectl(args: string[]): Promise<string> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const fullArgs = [...this.kubectlArgs(), ...args];
    try {
      const { stdout } = await exec('kubectl', fullArgs, { timeout: 15_000 });
      return stdout.trim();
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new Error('kubectl not found — is it installed?');
      throw err;
    }
  }

  async *buildImage(options: RuntimeBuildOptions): AsyncGenerator<BuildEvent> {
    // K8s doesn't build locally — delegate to Docker for the build step,
    // then the image must be pushed to a registry accessible by the cluster.
    const { buildImage } = await import('./docker-engine.js');
    yield* buildImage(options);
  }

  async startContainer(options: RuntimeRunOptions): Promise<string> {
    const podSpec = this.buildPodSpec(options);
    const manifest = JSON.stringify(podSpec);

    await this.ensureNamespace();
    await this.kubectl(['apply', '-f', '-', '--stdin']);

    // Use create with raw stdin via child_process for the manifest
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    await exec('kubectl', [...this.kubectlArgs(), 'apply', '-f', '-'], {
      env: { ...process.env },
    }).catch(async () => {
      // Fallback: write to temp file
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const tmpFile = path.join(os.tmpdir(), `preflight-pod-${options.name}.json`);
      fs.writeFileSync(tmpFile, manifest);
      await this.kubectl(['apply', '-f', tmpFile]);
      fs.unlinkSync(tmpFile);
    });

    return options.name;
  }

  async stopContainer(name: string): Promise<void> {
    await this.kubectl(['delete', 'pod', name, '--ignore-not-found', '--grace-period=10']).catch(() => {});
  }

  async getContainerStatus(name: string): Promise<ContainerStatus> {
    try {
      const json = await this.kubectl(['get', 'pod', name, '-o', 'json']);
      const pod = JSON.parse(json);
      const phase = pod.status?.phase?.toLowerCase() ?? 'unknown';

      const statusMap: Record<string, ContainerStatus> = {
        running: 'running',
        succeeded: 'exited',
        failed: 'exited',
        pending: 'created',
      };
      return statusMap[phase] ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async isContainerRunning(name: string): Promise<boolean> {
    const status = await this.getContainerStatus(name);
    return status === 'running';
  }

  async getContainerLogs(name: string, lines = 100): Promise<string> {
    return this.kubectl(['logs', name, `--tail=${lines}`]).catch(() => '');
  }

  async execInContainer(name: string, command: string): Promise<RuntimeExecResult> {
    try {
      const stdout = await this.kubectl(['exec', name, '--', 'sh', '-c', command]);
      return { stdout, exitCode: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { stdout: msg, exitCode: 1 };
    }
  }

  async ensureNetwork(_name: string): Promise<void> {
    // K8s uses its own network model — Pods in the same namespace can communicate
    await this.ensureNamespace();
  }

  async removeNetwork(_name: string): Promise<void> {
    // No-op in K8s — namespace-level isolation
  }

  async waitForHealthy(name: string, timeoutMs = 120_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getContainerStatus(name);
      if (status === 'running') return true;
      if (status === 'exited' || status === 'dead') return false;
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  }

  // ----- Internal -----

  private async ensureNamespace(): Promise<void> {
    await this.kubectl(['create', 'namespace', this.namespace, '--dry-run=client', '-o', 'yaml'])
      .then(yaml => this.kubectl(['apply', '-f', '-']))
      .catch(() => {});
  }

  private buildPodSpec(options: RuntimeRunOptions): Record<string, unknown> {
    const container: Record<string, unknown> = {
      name: options.name,
      image: options.image,
      ports: options.ports.map(p => {
        const [, containerPort] = p.split(':');
        return { containerPort: parseInt(containerPort, 10) };
      }),
    };

    if (options.environment) {
      container.env = Object.entries(options.environment).map(([name, value]) => ({ name, value }));
    }

    const resources: Record<string, Record<string, string>> = {};
    if (options.cpuLimit || options.memoryLimit) {
      resources.limits = {};
      if (options.cpuLimit) resources.limits.cpu = `${options.cpuLimit * 1000}m`;
      if (options.memoryLimit) resources.limits.memory = options.memoryLimit;
    }
    if (Object.keys(resources).length > 0) container.resources = resources;

    const spec: Record<string, unknown> = {
      containers: [container],
      restartPolicy: 'Never',
    };

    if (this.imagePullSecret) {
      spec.imagePullSecrets = [{ name: this.imagePullSecret }];
    }
    if (this.nodeSelector) {
      spec.nodeSelector = this.nodeSelector;
    }

    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: options.name,
        namespace: this.namespace,
        labels: { 'app.kubernetes.io/managed-by': 'preflight' },
      },
      spec,
    };
  }
}

// =====================================================================
// HostRuntime — run test commands directly on the host (no containers)
// =====================================================================

/**
 * A runtime that executes test commands directly on the host machine, without
 * any container layer. Used when `e2e.yaml` declares `runtime: { type: host }`.
 *
 * Design:
 * - `execInContainer` ignores the `name` argument (there are no containers)
 *   and runs the command via `sh -c` on the host. This lets all 41 YAML
 *   suites (which carry `container: recursive-e2e`) work unchanged — the
 *   container name is simply disregarded.
 * - Container lifecycle methods (`buildImage`, `startContainer`, `ensureNetwork`,
 *   `waitForHealthy`, …) are no-ops. The service under test is expected to
 *   already be built (`cargo build`) and running (or invokable directly as a
 *   CLI binary) on the host. Mock services are started by the plugin's
 *   `setup()` hook (typically as a local `docker run -p` or in-process server).
 */
export class HostRuntime implements ContainerRuntime {
  readonly name = 'host';
  /**
   * When set, `/workspace` in exec commands and file paths is transparently
   * mapped to this directory. This lets the 33+ YAML suites that hardcode
   * `/workspace/...` (a container path) run on the host unchanged.
   * Set via `RuntimeConfig.host.workspaceDir` or the `E2E_WORKSPACE_DIR` env var.
   */
  private readonly workspaceDir: string | undefined;

  constructor(workspaceDir?: string) {
    // env override takes precedence (set by e2e-run-host.sh or CI)
    this.workspaceDir = workspaceDir ?? process.env.E2E_WORKSPACE_DIR ?? undefined;
  }

  /**
   * Rewrite container-specific tokens to host equivalents in a command:
   * 1. `/workspace` → `workspaceDir` (path mapping)
   * 2. `aimock:PORT` → `localhost:PORT` (Docker DNS → host port)
   * 3. Any `key=value` pair in `E2E_HOST_REPLACEMENTS` env (space-separated)
   */
  private mapPath(s: string): string {
    let result = s;
    // 1. /workspace → workspaceDir
    if (this.workspaceDir) {
      result = result.replace(/\/workspace(?=[/\s'"]|$)/g, this.workspaceDir);
    }
    // 2. aimock:PORT → localhost:PORT (common Docker network DNS → host)
    result = result.replace(/aimock:(\d+)/g, 'localhost:$1');
    // 3. Generic replacements from env: "old1=new1 old2=new2"
    const reps = process.env.E2E_HOST_REPLACEMENTS;
    if (reps) {
      for (const pair of reps.split(/\s+/)) {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          const old = pair.slice(0, eq);
          const newVal = pair.slice(eq + 1);
          result = result.split(old).join(newVal);
        }
      }
    }
    return result;
  }

  async *buildImage(_options: RuntimeBuildOptions): AsyncGenerator<BuildEvent> {
    // No image to build in host mode — the binary is compiled separately.
    // Yield nothing; the generator protocol completes immediately.
  }

  async startContainer(_options: RuntimeRunOptions): Promise<string> {
    // No container to start. Return a sentinel name so callers that expect a
    // container ID don't break. This value is never used to exec into.
    return 'host';
  }

  async stopContainer(_name: string): Promise<void> {
    // Nothing to stop.
  }

  async getContainerStatus(_name: string): Promise<ContainerStatus> {
    return 'running';
  }

  async isContainerRunning(_name: string): Promise<boolean> {
    return true;
  }

  async getContainerLogs(_name: string, _lines = 100): Promise<string> {
    return '';
  }

  async execInContainer(_name: string, command: string): Promise<RuntimeExecResult> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    // Map /workspace → workspaceDir so container-path commands work on host.
    const mappedCommand = this.mapPath(command);
    // Mirror Docker's WORKDIR: when a workspaceDir is configured (the host
    // equivalent of the container's `/workspace`), run the command with that
    // as the cwd. Without this, a host-mode process inherits the daemon's cwd
    // and commands that rely on relative paths (or on the binary's default
    // workspace = cwd, e.g. `recursive http` with no --workspace) would
    // resolve files outside the mapped workspace — diverging from Docker mode.
    const execOpts: { encoding: 'utf-8'; timeout: number; env: NodeJS.ProcessEnv; cwd?: string } = {
      encoding: 'utf-8',
      timeout: 15_000,
      // Inherit the test process's environment so PATH-resolved binaries
      // (recursive, jq, find, …) are found.
      env: { ...process.env },
    };
    if (this.workspaceDir) {
      execOpts.cwd = this.workspaceDir;
    }
    try {
      const { stdout } = await exec('sh', ['-c', mappedCommand], execOpts);
      return { stdout: stdout.trim(), exitCode: 0 };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number | string };
      const output = (execErr.stdout || execErr.stderr || '').trim();
      const rawCode = execErr.code;
      const exitCode = typeof rawCode === 'number' ? rawCode : 1;
      return { stdout: output, exitCode };
    }
  }

  async ensureNetwork(_name: string): Promise<void> {
    // No Docker network needed in host mode.
  }

  async removeNetwork(_name: string): Promise<void> {
    // No-op.
  }

  async waitForHealthy(_name: string, _timeoutMs = 120_000): Promise<boolean> {
    // The host is always "healthy" from our perspective.
    return true;
  }
}

// =====================================================================
// Factory
// =====================================================================

export type RuntimeType = 'docker' | 'kubernetes' | 'host';

export interface HostRuntimeOptions {
  /** Map /workspace → this dir in exec commands (enables container-path YAMLs on host). */
  workspaceDir?: string;
}

export interface RuntimeConfig {
  type?: RuntimeType;
  kubernetes?: K8sRuntimeOptions;
  host?: HostRuntimeOptions;
}

export function createRuntime(config?: RuntimeConfig): ContainerRuntime {
  const type = config?.type ?? 'docker';
  if (type === 'kubernetes') {
    return new KubernetesRuntime(config?.kubernetes);
  }
  if (type === 'host') {
    return new HostRuntime(config?.host?.workspaceDir);
  }
  return new DockerRuntime();
}
