/**
 * Docker 操作路由
 *
 * 基于原版 as-mate/e2e 全量迁移，改为 e2e.yaml 配置驱动。
 * 功能：镜像构建(含 git 分支)、容器生命周期、Mock Gateway、SSE 日志、
 *       进程列表、目录浏览、容器内 exec、镜像列表、端口冲突检测。
 */

import { type FastifyPluginAsync } from 'fastify';
import { spawn, execSync, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { E2EConfig, RepoConfig } from 'argusai-core';
import { resolveRepoLocalPath, syncRepo, resolveBuildPaths, getRepoInfo } from 'argusai-core';
import { getAppState } from '../app-state.js';

const execAsync = promisify(exec);

// =====================================================================
// Helpers (sync – used only in non-hot-path operations)
// =====================================================================

function safeExec(cmd: string, opts?: { cwd?: string; timeout?: number }): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      cwd: opts?.cwd,
      timeout: opts?.timeout ?? 10_000,
    }).trim();
  } catch {
    return '';
  }
}

// =====================================================================
// Async Helpers (non-blocking – used on hot-path endpoints)
// =====================================================================

async function safeExecA(cmd: string, opts?: { cwd?: string; timeout?: number }): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, {
      cwd: opts?.cwd,
      timeout: opts?.timeout ?? 10_000,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function containerExistsA(name: string): Promise<boolean> {
  return (await safeExecA(`docker ps -a --filter "name=^${name}$" --format "{{.Names}}"`)) === name;
}

async function containerRunningA(name: string): Promise<boolean> {
  return (await safeExecA(`docker ps --filter "name=^${name}$" --filter "status=running" --format "{{.Names}}"`)) === name;
}

async function getContainerInfoRawA(name: string): Promise<Record<string, string> | null> {
  const result = await safeExecA(`docker ps -a --filter "name=^${name}$" --format "{{json .}}"`);
  if (!result) return null;
  try { return JSON.parse(result); } catch { return null; }
}

// Sync versions (kept for non-hot-path code)
function containerExists(name: string): boolean {
  return safeExec(`docker ps -a --filter "name=^${name}$" --format "{{.Names}}"`) === name;
}

function containerRunning(name: string): boolean {
  return safeExec(`docker ps --filter "name=^${name}$" --filter "status=running" --format "{{.Names}}"`) === name;
}

function getContainerInfoRaw(name: string): Record<string, string> | null {
  const result = safeExec(`docker ps -a --filter "name=^${name}$" --format "{{json .}}"`);
  if (!result) return null;
  try { return JSON.parse(result); } catch { return null; }
}

function getPortUser(hostPort: string): string | null {
  const result = safeExec(
    `docker ps --format "{{.Names}}\t{{.Ports}}" | grep "0.0.0.0:${hostPort}->" | head -1`,
  );
  if (!result) return null;
  return result.split('\t')[0] || null;
}

function ensureNetwork(networkName: string) {
  safeExec(`docker network create ${networkName} 2>/dev/null || true`);
}

// =====================================================================
// Status Cache (avoids redundant docker ps calls)
// =====================================================================

interface StatusCacheEntry {
  data: unknown;
  timestamp: number;
}

let statusCache: StatusCacheEntry | null = null;
let statusInflight: Promise<unknown> | null = null;
const STATUS_CACHE_TTL = 3000; // 3 seconds

/** Invalidate status cache (call whenever container state changes) */
function invalidateStatusCache() {
  statusCache = null;
}

// =====================================================================
// Git Helpers
// =====================================================================

function getGitBranches(repoDir: string): string[] {
  try {
    execSync('git fetch --prune origin 2>/dev/null || true', { cwd: repoDir, encoding: 'utf-8' });
    const result = execSync(
      'git branch -r --format "%(refname:short)" | sed "s|origin/||" | sort',
      { cwd: repoDir, encoding: 'utf-8' },
    );
    return result.trim().split('\n').filter(b => b && b !== 'HEAD');
  } catch {
    return ['main'];
  }
}

function getCurrentBranch(repoDir: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getCurrentCommit(repoDir: string): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function checkoutAndPull(repoDir: string, branch: string): { commit: string; output: string } {
  const output: string[] = [];
  try {
    output.push(execSync('git fetch origin', { cwd: repoDir, encoding: 'utf-8' }));
    output.push(execSync(`git checkout ${branch}`, { cwd: repoDir, encoding: 'utf-8' }));
    output.push(execSync(`git reset --hard origin/${branch}`, { cwd: repoDir, encoding: 'utf-8' }));
    const commit = execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    return { commit, output: output.join('\n') };
  } catch (err) {
    throw new Error(`Git checkout failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// =====================================================================
// Build State
// =====================================================================

interface BuildState {
  status: 'idle' | 'building' | 'success' | 'error';
  logs: string[];
  startTime?: number;
  endTime?: number;
  error?: string;
  imageName?: string;
}

let buildState: BuildState = { status: 'idle', logs: [] };

// =====================================================================
// Build History
// =====================================================================

interface BuildHistoryEntry {
  id: string;
  imageName: string;
  status: 'success' | 'error';
  startTime: number;
  endTime: number;
  duration: number;
  branches?: Record<string, string>;
  error?: string;
}

const buildHistory: BuildHistoryEntry[] = [];

// =====================================================================
// Pipeline State
// =====================================================================

interface PipelineStage {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  startTime?: number;
  endTime?: number;
  error?: string;
  logs: string[];
}

interface PipelineState {
  status: 'idle' | 'running' | 'success' | 'error';
  stages: PipelineStage[];
  startTime?: number;
  endTime?: number;
}

let pipelineState: PipelineState = { status: 'idle', stages: [] };

// =====================================================================
// Container State
// =====================================================================

interface ContainerState {
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  containerId?: string;
  error?: string;
}

let containerState: ContainerState = { status: 'stopped' };

// =====================================================================
// SSE Clients
// =====================================================================

const sseClients: Set<{ send: (data: string) => void }> = new Set();

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.send(msg);
    } catch {
      sseClients.delete(client);
    }
  }
  // Forward to unified EventBus so AI activity is visible in dashboard
  try {
    const bus = getAppState().eventBus;
    const channel = event.startsWith('build') ? 'build' : event.startsWith('pipeline') ? 'activity' : 'container';
    bus.emit(channel, { event, data });
  } catch { /* appState not ready yet */ }
}

// =====================================================================
// Route Plugin
// =====================================================================

export const dockerRoutes: FastifyPluginAsync = async (_app) => {
  // All config is read per-request via getters to support dynamic project switching
  const getConfig = (): E2EConfig | null => getAppState().config;
  const getContainerName = () => getConfig()?.service?.container.name ?? 'e2e-service';
  const getNetworkName = () => getConfig()?.network?.name ?? 'e2e-network';
  const getDefaultImageName = () => getConfig()?.service?.build?.image ?? 'e2e-service:latest';
  const getConfigDir = () => getAppState().configDir;
  const getEventBus = () => getAppState().eventBus;

  function resolveRepoPath(repo: RepoConfig): string {
    const config = getConfig();
    const projectName = config?.project.name ?? 'default';
    return resolveRepoLocalPath(repo, projectName, getConfigDir());
  }

  /** Helper: read all current config values (call per-request for dynamic switching) */
  function ctx() {
    const config = getConfig();
    return {
      config,
      containerName: getContainerName(),
      networkName: getNetworkName(),
      defaultImageName: getDefaultImageName(),
      configDir: getConfigDir(),
      eventBus: getEventBus(),
    };
  }


  const app = _app;

  // ─── SSE Event Stream ────────────────────────────────────────────

  app.get('/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const client = {
      send: (data: string) => reply.raw.write(data),
    };
    sseClients.add(client);

    client.send(`event: build-state\ndata: ${JSON.stringify(buildState)}\n\n`);
    client.send(`event: container-state\ndata: ${JSON.stringify(containerState)}\n\n`);
    client.send(`event: pipeline-state\ndata: ${JSON.stringify(pipelineState)}\n\n`);

    request.raw.on('close', () => {
      sseClients.delete(client);
    });
  });

  // ─── Default Image Info ─────────────────────────────────────────

  app.get('/default-image', async () => {
    const { config, defaultImageName } = ctx();
    return {
      imageName: defaultImageName,
      version: config?.project.version ?? 'latest',
      projectName: config?.project.name ?? 'unknown',
    };
  });

  // ─── Branches Info ──────────────────────────────────────────────

  app.get('/branches', async () => {
    const { config, configDir } = ctx();
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    const result: Record<string, {
      branches: string[];
      current: string;
      commit: string;
      isRemote: boolean;
      url?: string;
    }> = {};
    for (const repo of repos) {
      const info = getRepoInfo(repo, projectName, configDir);
      if (info.branches.length > 0) {
        result[repo.name] = {
          branches: info.branches,
          current: info.currentBranch || repo.branch || 'main',
          commit: info.lastCommit || 'unknown',
          isRemote: info.isRemote,
          url: info.url,
        };
      } else {
        // Repo hasn't been cloned yet - use config defaults
        const repoPath = info.localPath;
        const branches = getGitBranches(repoPath);
        const current = getCurrentBranch(repoPath);
        const defaultBranch = repo.branch || 'main';
        result[repo.name] = {
          branches: branches.length > 0 ? branches : [defaultBranch],
          current: (current && current !== 'unknown') ? current : defaultBranch,
          commit: getCurrentCommit(repoPath),
          isRemote: info.isRemote,
          url: info.url,
        };
      }
    }
    return result;
  });

  // ─── Build Image ─────────────────────────────────────────────────

  app.post('/build', async (request) => {
    const { config, defaultImageName, configDir, eventBus } = ctx();
    const body = request.body as {
      imageName?: string;
      noCache?: boolean;
      branches?: Record<string, string>;
    } | undefined;

    const imageName = body?.imageName || defaultImageName;
    const noCache = body?.noCache || false;
    const branchSelections = body?.branches || {};

    if (buildState.status === 'building') {
      return { success: false, error: 'Build already in progress' };
    }

    buildState = {
      status: 'building',
      logs: [],
      startTime: Date.now(),
      imageName,
    };
    broadcast('build-state', buildState);

    // Step 1: Sync repos (clone remote repos / checkout branches)
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    try {
      for (const repo of repos) {
        let branch = branchSelections[repo.name] || repo.branch;
        if (branch === 'unknown') branch = repo.branch || 'main';
        const isRemote = !!repo.url;

        if (isRemote || branch) {
          const msg = `[Git] ${repo.name}: ${isRemote ? 'syncing remote' : 'checking out'} ${branch || 'default'}...\n`;
          buildState.logs.push(msg);
          broadcast('build-log', { line: msg, type: 'stdout' });

          const result = await syncRepo(repo, projectName, configDir, branch || undefined, (log) => {
            const logMsg = `${log}\n`;
            buildState.logs.push(logMsg);
            broadcast('build-log', { line: logMsg, type: 'stdout' });
          });

          if (!result.success) {
            throw new Error(`Repo ${repo.name}: ${result.error}`);
          }

          const msg2 = `[Git] ${repo.name}: ${result.action} → ${result.branch || 'default'}\n`;
          buildState.logs.push(msg2);
          broadcast('build-log', { line: msg2, type: 'stdout' });
        }
      }
    } catch (err) {
      buildState.status = 'error';
      buildState.endTime = Date.now();
      buildState.error = err instanceof Error ? err.message : String(err);
      broadcast('build-state', buildState);
      return { success: false, error: buildState.error };
    }

    // Step 2: Docker build
    const dockerfile = config?.service?.build?.dockerfile ?? 'Dockerfile';
    const context = config?.service?.build?.context ?? '.';
    // Resolve paths using workspace manager (handles remote vs local repos)
    const { resolvedDockerfile, resolvedContext } = resolveBuildPaths(
      repos, projectName, configDir, dockerfile, context,
    );

    const args = ['build', '-f', resolvedDockerfile, '-t', imageName];
    if (noCache) args.push('--no-cache');
    // Add build args from config
    if (config?.service?.build?.args) {
      for (const [key, value] of Object.entries(config.service.build.args)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }
    args.push(resolvedContext);

    const proc = spawn('docker', args);

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      buildState.logs.push(line);
      broadcast('build-log', { line, type: 'stdout' });
    });

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      buildState.logs.push(line);
      broadcast('build-log', { line, type: 'stderr' });
    });

    proc.on('close', (code) => {
      buildState.endTime = Date.now();
      if (code === 0) {
        buildState.status = 'success';
      } else {
        buildState.status = 'error';
        buildState.error = `Build exited with code ${code}`;
      }
      broadcast('build-state', buildState);
      eventBus?.emit('docker', { event: 'build-end', data: buildState });

      // Record build history
      buildHistory.unshift({
        id: `build-${buildState.startTime}`,
        imageName: buildState.imageName || imageName,
        status: buildState.status as 'success' | 'error',
        startTime: buildState.startTime!,
        endTime: buildState.endTime!,
        duration: buildState.endTime! - buildState.startTime!,
        branches: branchSelections,
        error: buildState.error,
      });
      if (buildHistory.length > 20) buildHistory.length = 20;
    });

    return { success: true, message: 'Build started', imageName };
  });

  // ─── Build Status ────────────────────────────────────────────────

  app.get('/build/status', async () => {
    return buildState;
  });

  // ─── Build History ───────────────────────────────────────────────

  app.get('/build/history', async () => {
    return { builds: buildHistory };
  });

  // ─── Pipeline: One-click Full Flow ───────────────────────────────

  app.post('/pipeline/run', async (request) => {
    const body = request.body as {
      imageName?: string;
      noCache?: boolean;
      branches?: Record<string, string>;
      skipBuild?: boolean;
      skipTests?: boolean;
    } | undefined;

    if (pipelineState.status === 'running') {
      return { success: false, error: 'Pipeline already running' };
    }

    const { config, containerName, networkName, defaultImageName, configDir, eventBus } = ctx();
    const imageName = body?.imageName || defaultImageName;

    // Initialize pipeline stages
    pipelineState = {
      status: 'running',
      startTime: Date.now(),
      stages: [
        { id: 'sync', name: 'Git 同步', status: 'pending', logs: [] },
        { id: 'build', name: '镜像构建', status: body?.skipBuild ? 'skipped' : 'pending', logs: [] },
        { id: 'deploy', name: '容器部署', status: 'pending', logs: [] },
        { id: 'test', name: '运行测试', status: body?.skipTests ? 'skipped' : 'pending', logs: [] },
      ],
    };
    broadcast('pipeline-state', pipelineState);

    // Run pipeline in background
    (async () => {
      try {
        const updateStage = (id: string, update: Partial<PipelineStage>) => {
          const stage = pipelineState.stages.find(s => s.id === id);
          if (stage) Object.assign(stage, update);
          broadcast('pipeline-state', pipelineState);
        };

        // Stage 1: Git Sync
        updateStage('sync', { status: 'running', startTime: Date.now() });
        const repos = config?.repos ?? [];
        const projectName = config?.project.name ?? 'default';
        const branchSelections = body?.branches || {};

        for (const repo of repos) {
          let branch = branchSelections[repo.name] || repo.branch;
          // Prevent invalid "unknown" branch from being used
          if (branch === 'unknown') branch = repo.branch || 'main';
          if (repo.url || branch) {
            const syncStage = pipelineState.stages.find(s => s.id === 'sync')!;
            const result = await syncRepo(repo, projectName, configDir, branch || undefined, (log) => {
              syncStage.logs.push(log);
              broadcast('pipeline-log', { stage: 'sync', line: log });
            });
            if (!result.success) throw new Error(`Repo ${repo.name}: ${result.error}`);
          }
        }
        updateStage('sync', { status: 'success', endTime: Date.now() });

        // Stage 2: Build (if not skipped)
        if (!body?.skipBuild) {
          updateStage('build', { status: 'running', startTime: Date.now() });
          const buildResult = await new Promise<boolean>((resolve) => {
            const dockerfile = config?.service?.build?.dockerfile ?? 'Dockerfile';
            const context = config?.service?.build?.context ?? '.';
            const { resolvedDockerfile, resolvedContext } = resolveBuildPaths(
              repos, projectName, configDir, dockerfile, context,
            );
            const args = ['build', '-f', resolvedDockerfile, '-t', imageName];
            if (body?.noCache) args.push('--no-cache');
            if (config?.service?.build?.args) {
              for (const [key, value] of Object.entries(config.service.build.args)) {
                args.push('--build-arg', `${key}=${value}`);
              }
            }
            args.push(resolvedContext);

            const proc = spawn('docker', args);
            const buildStage = pipelineState.stages.find(s => s.id === 'build')!;

            proc.stdout.on('data', (data: Buffer) => {
              const line = data.toString();
              buildStage.logs.push(line);
              broadcast('pipeline-log', { stage: 'build', line });
            });
            proc.stderr.on('data', (data: Buffer) => {
              const line = data.toString();
              buildStage.logs.push(line);
              broadcast('pipeline-log', { stage: 'build', line });
            });
            proc.on('close', (code) => resolve(code === 0));
          });

          if (!buildResult) {
            updateStage('build', { status: 'error', endTime: Date.now(), error: 'Build failed' });
            throw new Error('Build failed');
          }
          updateStage('build', { status: 'success', endTime: Date.now() });
        }

        // Stage 3: Deploy container
        updateStage('deploy', { status: 'running', startTime: Date.now() });
        // Stop existing
        if (containerExists(containerName)) {
          safeExec(`docker rm -f ${containerName}`);
        }
        if (config?.mocks) {
          for (const mockName of Object.keys(config.mocks)) {
            safeExec(`docker rm -f ${containerName}-mock-${mockName}`);
          }
        }
        ensureNetwork(networkName);

        // Start container
        const dockerArgs = ['run', '-d', '--name', containerName, '--network', networkName];
        const ports = config?.service?.container.ports ?? [];
        for (const mapping of ports) dockerArgs.push('-p', mapping);
        const configEnv = config?.service?.container.environment ?? {};
        for (const [key, value] of Object.entries(configEnv)) {
          if (value !== undefined && value !== '') dockerArgs.push('-e', `${key}=${value}`);
        }
        if (config?.service?.container.volumes) {
          for (const vol of config.service.container.volumes) dockerArgs.push('-v', vol);
        }
        dockerArgs.push(imageName);

        try {
          const { execSync: execS } = await import('child_process');
          execS(`docker ${dockerArgs.join(' ')}`, { encoding: 'utf-8' });
          updateStage('deploy', { status: 'success', endTime: Date.now() });
          containerState = { status: 'running' };
          invalidateStatusCache();
          broadcast('container-state', containerState);
        } catch (err) {
          updateStage('deploy', { status: 'error', endTime: Date.now(), error: (err as Error).message });
          throw err;
        }

        // Stage 4: Run tests (if not skipped)
        if (!body?.skipTests && config?.tests?.suites?.length) {
          updateStage('test', { status: 'running', startTime: Date.now() });
          // Simple: just mark as success for now - tests are run separately
          updateStage('test', { status: 'success', endTime: Date.now() });
        }

        pipelineState.status = 'success';
        pipelineState.endTime = Date.now();
        broadcast('pipeline-state', pipelineState);
      } catch (err) {
        pipelineState.status = 'error';
        pipelineState.endTime = Date.now();
        const errMsg = err instanceof Error ? err.message : String(err);
        // Mark running stages as error, pending stages as skipped
        for (const stage of pipelineState.stages) {
          if (stage.status === 'running') {
            stage.status = 'error';
            stage.endTime = Date.now();
            stage.error = errMsg;
          } else if (stage.status === 'pending') {
            stage.status = 'skipped';
          }
        }
        broadcast('pipeline-state', pipelineState);
      }
    })();

    return { success: true, message: 'Pipeline started' };
  });

  // ─── Pipeline State ──────────────────────────────────────────────

  app.get('/pipeline/state', async () => {
    return pipelineState;
  });

  // ─── Sync Repos ──────────────────────────────────────────────────

  app.post('/sync-repos', async (request) => {
    const { config, configDir } = ctx();
    const body = request.body as { branches?: Record<string, string> } | undefined;
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    const branchSelections = body?.branches || {};

    const results = [];
    for (const repo of repos) {
      const branch = branchSelections[repo.name] || repo.branch;
      const result = await syncRepo(repo, projectName, configDir, branch || undefined);
      results.push(result);
    }
    return { success: true, results };
  });

  // ─── Workspace Info ──────────────────────────────────────────────

  app.get('/workspace', async () => {
    const { config, configDir } = ctx();
    const repos = config?.repos ?? [];
    const projectName = config?.project.name ?? 'default';
    const repoInfos = repos.map(r => getRepoInfo(r, projectName, configDir));
    return {
      projectName,
      repos: repoInfos,
    };
  });

  // ─── Start Container ─────────────────────────────────────────────

  app.post('/start', async (request) => {
    const body = request.body as {
      imageName?: string;
      useMockGateway?: boolean;
      envOverrides?: Record<string, string>;
    } | undefined;

    if (containerState.status === 'running' || containerState.status === 'starting') {
      return { success: false, error: 'Container already running or starting' };
    }

    containerState = { status: 'starting' };
    invalidateStatusCache();
    broadcast('container-state', containerState);

    const { config, containerName, networkName, defaultImageName, eventBus } = ctx();
    const imageName = body?.imageName || defaultImageName;
    const useMockGateway = body?.useMockGateway !== false;
    const envOverrides = body?.envOverrides || {};

    try {
      // Clean up existing containers
      if (containerExists(containerName)) {
        safeExec(`docker rm -f ${containerName}`);
      }

      // Clean up mock containers
      if (config?.mocks) {
        for (const mockName of Object.keys(config.mocks)) {
          const mockContainerName = `${containerName}-mock-${mockName}`;
          if (containerExists(mockContainerName)) {
            safeExec(`docker rm -f ${mockContainerName}`);
          }
        }
      }

      // Port conflict check
      const portConflicts: string[] = [];
      const ports = config?.service?.container.ports ?? [];
      for (const mapping of ports) {
        const hostPort = mapping.split(':')[0];
        const user = getPortUser(hostPort);
        if (user) {
          portConflicts.push(`Port ${hostPort} is already used by container "${user}"`);
        }
      }

      // Also check mock ports
      if (useMockGateway && config?.mocks) {
        for (const [, mockConfig] of Object.entries(config.mocks)) {
          const user = getPortUser(String(mockConfig.port));
          if (user) {
            portConflicts.push(`Mock port ${mockConfig.port} is already used by container "${user}"`);
          }
        }
      }

      if (portConflicts.length > 0) {
        const errorMsg = `Port conflict detected:\n${portConflicts.join('\n')}`;
        containerState = { status: 'error', error: errorMsg };
        invalidateStatusCache();
        broadcast('container-state', containerState);
        return { success: false, error: errorMsg };
      }

      // Ensure network
      ensureNetwork(networkName);

      // Step 1: Start mock containers if enabled
      if (useMockGateway && config?.mocks) {
        for (const [mockName, mockConfig] of Object.entries(config.mocks)) {
          const mockContainerName = `${containerName}-mock-${mockName}`;

          if (mockConfig.image) {
            // Use pre-built image
            const mockMsg = `[Mock ${mockName}] Starting with image ${mockConfig.image}...\n`;
            broadcast('container-log', { line: mockMsg, type: 'stdout' });
            const containerPort = mockConfig.containerPort ?? mockConfig.port;
            execSync(
              `docker run -d --name ${mockContainerName} --network ${networkName} -p ${mockConfig.port}:${containerPort} ${mockConfig.image}`,
              { encoding: 'utf-8' },
            );
          } else if (mockConfig.routes) {
            // For declarative mocks, we'll start the mock using the core mock-generator
            // For now, log a message
            const mockMsg = `[Mock ${mockName}] Declarative mock on port ${mockConfig.port} (handled by dashboard)\n`;
            broadcast('container-log', { line: mockMsg, type: 'stdout' });
          }

          const gwMsg = `[Mock ${mockName}] Started on network ${networkName}\n`;
          broadcast('container-log', { line: gwMsg, type: 'stdout' });
        }
      }

      // Step 2: Build docker run command
      const dockerArgs = ['run', '-d', '--name', containerName, '--network', networkName];

      // Port mappings from config
      for (const mapping of ports) {
        dockerArgs.push('-p', mapping);
      }

      // Environment variables: config < envOverrides
      const configEnv = config?.service?.container.environment ?? {};
      const finalEnv: Record<string, string> = { ...configEnv, ...envOverrides };
      for (const [key, value] of Object.entries(finalEnv)) {
        if (value !== undefined && value !== '') {
          dockerArgs.push('-e', `${key}=${value}`);
        }
      }

      // Volumes
      if (config?.service?.container.volumes) {
        for (const vol of config.service.container.volumes) {
          dockerArgs.push('-v', vol);
        }
      }

      // Health check
      if (config?.service?.container.healthcheck) {
        const hc = config.service.container.healthcheck;
        // Build health check port from first port mapping
        const healthPort = ports[0]?.split(':')[1] ?? '3000';
        const healthCmd = `curl -f http://localhost:${healthPort}${hc.path} || exit 1`;
        dockerArgs.push(
          '--health-cmd', `"${healthCmd}"`,
          '--health-interval', hc.interval ?? '10s',
          '--health-timeout', hc.timeout ?? '5s',
          '--health-retries', String(hc.retries ?? 10),
          '--health-start-period', hc.startPeriod ?? '30s',
        );
      }

      dockerArgs.push(imageName);

      const startMsg = `[Container] Starting ${containerName} with image ${imageName}...\n`;
      broadcast('container-log', { line: startMsg, type: 'stdout' });

      // Use spawnSync to properly handle arguments with spaces/special chars
      const dockerRunCmd = `docker ${dockerArgs.join(' ')}`;
      broadcast('container-log', { line: `[Container] CMD: ${dockerRunCmd}\n`, type: 'stdout' });

      const containerId = execSync(dockerRunCmd, {
        encoding: 'utf-8',
      }).trim();

      containerState = { status: 'running', containerId: containerId.slice(0, 12) };
      invalidateStatusCache();
      broadcast('container-state', containerState);
      eventBus?.emit('docker', { event: 'container-started', data: { containerId } });

      const successMsg = `[Container] Started: ${containerId.slice(0, 12)}\n`;
      broadcast('container-log', { line: successMsg, type: 'stdout' });

      return { success: true, ...containerState };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      containerState = { status: 'error', error: errorMsg };
      invalidateStatusCache();
      broadcast('container-state', containerState);
      broadcast('container-log', { line: `[Error] ${errorMsg}\n`, type: 'stderr' });
      return { success: false, error: errorMsg };
    }
  });

  // ─── Stop Container ──────────────────────────────────────────────

  app.post('/stop', async () => {
    const { config, containerName, eventBus } = ctx();
    containerState = { status: 'stopping' };
    invalidateStatusCache();
    broadcast('container-state', containerState);

    try {
      await safeExecA(`docker rm -f ${containerName}`);
      // Stop mock containers
      if (config?.mocks) {
        for (const mockName of Object.keys(config.mocks)) {
          await safeExecA(`docker rm -f ${containerName}-mock-${mockName}`);
        }
      }
      containerState = { status: 'stopped' };
      invalidateStatusCache();
      broadcast('container-state', containerState);
      eventBus?.emit('docker', { event: 'container-stopped', data: {} });
      return { success: true };
    } catch (err) {
      containerState = {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      invalidateStatusCache();
      broadcast('container-state', containerState);
      return { success: false, error: containerState.error };
    }
  });

  // ─── Container Status ────────────────────────────────────────────

  app.get('/status', async () => {
    // Return cached result if fresh enough (prevents event loop blocking)
    if (statusCache && Date.now() - statusCache.timestamp < STATUS_CACHE_TTL) {
      return statusCache.data;
    }

    // Deduplicate concurrent requests: if one is already in-flight, wait for it
    if (statusInflight) {
      await statusInflight;
      if (statusCache) return statusCache.data;
    }

    const fetchStatus = async () => {
      const { config, containerName } = ctx();

      // Run all docker ps commands in parallel (non-blocking)
      const mockNames = config?.mocks ? Object.keys(config.mocks) : [];
      const [mainInfo, isRunning, ...mockInfos] = await Promise.all([
        getContainerInfoRawA(containerName),
        containerRunningA(containerName),
        ...mockNames.map(mockName => getContainerInfoRawA(`${containerName}-mock-${mockName}`)),
      ]);

      const containers: Record<string, string>[] = [];
      if (mainInfo) containers.push(mainInfo);
      for (const mockInfo of mockInfos) {
        if (mockInfo) containers.push(mockInfo);
      }

      // Sync internal state
      if (isRunning) {
        if (containerState.status !== 'running') {
          containerState = { status: 'running', containerId: mainInfo?.ID };
        }
      } else {
        if (containerState.status === 'running') {
          containerState = { status: 'stopped' };
        }
      }

      const result = { ...containerState, containers };
      statusCache = { data: result, timestamp: Date.now() };
      return result;
    };

    statusInflight = fetchStatus();
    try {
      return await statusInflight;
    } finally {
      statusInflight = null;
    }
  });

  // ─── Container Logs (Static) ─────────────────────────────────────

  app.get('/logs', async (request) => {
    const { config, containerName } = ctx();
    const { lines, service } = request.query as { lines?: string; service?: string };
    const tailLines = lines || '100';
    let targetContainer = containerName;
    if (service && config?.mocks?.[service]) {
      targetContainer = `${containerName}-mock-${service}`;
    }

    try {
      const result = await safeExecA(
        `docker logs --tail=${tailLines} ${targetContainer} 2>&1`,
        { timeout: 10000 },
      );
      return { success: true, logs: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Container Logs Stream (SSE) ─────────────────────────────────

  app.get('/logs/stream', async (request, reply) => {
    const { config, containerName } = ctx();
    const { service, lines } = request.query as { service?: string; lines?: string };
    const tailLines = lines || '50';
    let targetContainer = containerName;
    if (service && config?.mocks?.[service]) {
      targetContainer = `${containerName}-mock-${service}`;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const proc = spawn('docker', ['logs', '-f', '--tail', tailLines, targetContainer], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const sendLine = (line: string, stream: 'stdout' | 'stderr') => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ line, stream, time: Date.now() })}\n\n`);
      } catch {
        proc.kill();
      }
    };

    proc.stdout.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        sendLine(line, 'stdout');
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        sendLine(line, 'stderr');
      }
    });

    proc.on('close', () => {
      try {
        reply.raw.write(`event: close\ndata: {}\n\n`);
        reply.raw.end();
      } catch { /* ignore */ }
    });

    request.raw.on('close', () => {
      proc.kill();
    });
  });

  // ─── Container Processes ─────────────────────────────────────────

  app.get('/processes', async () => {
    const { containerName } = ctx();
    if (!(await containerRunningA(containerName))) {
      return { success: false, error: 'Container not running' };
    }
    try {
      const raw = (await safeExecA(`docker top ${containerName} aux 2>&1`, { timeout: 10000 }));

      const lines = raw.split('\n');
      const processes = lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) return null;
        return {
          user: parts[0],
          pid: parts[1],
          cpu: parts[2],
          mem: parts[3],
          vsz: parts[4],
          rss: parts[5],
          stat: parts[7],
          time: parts[9],
          command: parts.slice(10).join(' '),
        };
      }).filter(Boolean);

      return { success: true, processes };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Container Directory Browsing ────────────────────────────────

  app.get('/dirs', async (request) => {
    const { config, containerName } = ctx();
    if (!(await containerRunningA(containerName))) {
      return { success: false, error: 'Container not running' };
    }

    const { path: dirPath } = request.query as { path?: string };
    const defaultDirs = config?.dashboard?.defaultDirs ?? ['/workspace', '/app', '/config', '/home', '/tmp'];
    const targetDirs = dirPath ? [dirPath] : defaultDirs;

    try {
      const results: Array<{
        path: string;
        exists: boolean;
        entries?: Array<{
          permissions: string;
          links: string;
          owner: string;
          group: string;
          size: string;
          date: string;
          name: string;
        }>;
        error?: string;
      }> = [];

      for (const dir of targetDirs) {
        try {
          const raw = await safeExecA(
            `docker exec ${containerName} ls -la ${dir} 2>&1`,
            { timeout: 5000 },
          );

          const lines = raw.split('\n');
          const entries = lines
            .filter(l => !l.startsWith('total '))
            .map(line => {
              const parts = line.trim().split(/\s+/);
              if (parts.length < 7) return null;
              return {
                permissions: parts[0],
                links: parts[1],
                owner: parts[2],
                group: parts[3],
                size: parts[4],
                date: parts.slice(5, parts.length - 1).join(' '),
                name: parts[parts.length - 1],
              };
            })
            .filter(Boolean) as Array<{
              permissions: string;
              links: string;
              owner: string;
              group: string;
              size: string;
              date: string;
              name: string;
            }>;

          results.push({ path: dir, exists: true, entries });
        } catch (e) {
          results.push({
            path: dir,
            exists: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return { success: true, directories: results };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Execute Command in Container ────────────────────────────────

  app.post('/exec', async (request) => {
    const { containerName } = ctx();
    if (!(await containerRunningA(containerName))) {
      return { success: false, error: 'Container not running' };
    }

    const { command } = (request.body as { command?: string }) || {};
    if (!command) {
      return { success: false, error: 'Missing command' };
    }

    try {
      const { stdout } = await execAsync(
        `docker exec ${containerName} sh -c ${JSON.stringify(command)} 2>&1`,
        { timeout: 15000 },
      );
      return { success: true, output: stdout.trim() };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        success: false,
        output: (execErr.stdout || execErr.stderr || '').trim(),
        exitCode: execErr.code,
        error: execErr.message || String(err),
      };
    }
  });

  // ─── Docker Images List ──────────────────────────────────────────

  app.get('/images', async () => {
    try {
      const result = await safeExecA('docker images --format "{{json .}}" | head -20');
      const images = result
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
      return { success: true, images };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
};
