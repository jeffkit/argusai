/**
 * @module tools/clean
 * argus_clean — Stop and remove all containers, networks, and mocks.
 *
 * Uses MultiServiceOrchestrator for config normalization, while keeping
 * Docker calls at this level for testability.
 *
 * Default behavior is intentionally conservative: containers are stopped,
 * mock servers shut down, and the in-memory session is destroyed. By
 * default the Docker network and built images are KEPT so subsequent
 * `argus_setup` calls can reuse them without rebuilding. Pass
 * `removeNetwork: true` and/or `removeImages: true` for full teardown.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  stopContainer,
  removeNetwork,
  findContainersByLabel,
  MultiServiceOrchestrator,
  getDockerHostArgs,
} from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';

const execFileAsync = promisify(execFile);

export interface CleanResult {
  containers: Array<{
    name: string;
    action: 'removed' | 'not_found' | 'force_removed' | 'failed';
    error?: string;
  }>;
  mocks: Array<{
    name: string;
    action: 'stopped' | 'not_running' | 'failed';
    error?: string;
  }>;
  network: {
    name: string;
    action: 'removed' | 'not_found' | 'failed' | 'kept';
    error?: string;
  };
  images: Array<{
    name: string;
    action: 'removed' | 'not_found' | 'failed' | 'kept';
    error?: string;
  }>;
  sessionRemoved: boolean;
}

/**
 * Handle the argus_clean MCP tool call.
 *
 * Stops containers, shuts down mock servers, and destroys the session.
 * The Docker network is kept by default; pass `removeNetwork: true` to
 * remove it. Built images are kept by default; pass `removeImages: true`
 * to delete them.
 *
 * @param params - Tool input with projectPath and optional force/removeImages/removeNetwork flags
 * @param sessionManager - Session store for tracking project state
 * @returns Cleanup results for containers, mocks, network, images, and session
 */
export async function handleClean(
  params: { projectPath: string; force?: boolean; removeImages?: boolean; removeNetwork?: boolean },
  sessionManager: SessionManager,
): Promise<CleanResult> {
  let session;
  let networkName = 'e2e-network';

  try {
    session = sessionManager.getOrThrow(params.projectPath);
    networkName = session.networkName;
  } catch (err) {
    if (err instanceof SessionError && err.code === 'SESSION_NOT_FOUND') {
      return {
        containers: [],
        mocks: [],
        network: { name: networkName, action: 'not_found' },
        images: [],
        sessionRemoved: false,
      };
    }
    throw err;
  }

  const bus = sessionManager.eventBus;
  const cleanStart = Date.now();
  bus?.emit('clean', { event: 'clean_start', data: { type: 'clean_start', project: session.config.project.name, timestamp: cleanStart } });
  bus?.emit('activity', {
    event: 'activity_start',
    data: { id: `clean-${cleanStart}`, source: 'ai', operation: 'clean', project: session.config.project.name, status: 'running', startTime: cleanStart },
  });

  const orchestrator = new MultiServiceOrchestrator();
  const services = orchestrator.normalizeServices(session.config);

  // Collect all container names — from config, session tracking, and Docker labels
  const containerNames = new Set<string>();
  for (const svc of services) {
    containerNames.add(svc.container.name);
  }
  for (const [name] of session.containerIds) {
    containerNames.add(name);
  }
  try {
    const labeledContainers = await findContainersByLabel(
      `argusai.project=${session.config.project.name}`,
    );
    for (const name of labeledContainers) {
      containerNames.add(name);
    }
  } catch {
    // Best-effort: label-based lookup may fail if Docker is unreachable
  }

  // Stop containers (best-effort)
  const containerResults: CleanResult['containers'] = [];
  for (const name of containerNames) {
    try {
      bus?.emit('clean', { event: 'container_removing', data: { type: 'container_removing', name, timestamp: Date.now() } });
      await stopContainer(name);
      bus?.emit('clean', { event: 'container_removed', data: { type: 'container_removed', name, timestamp: Date.now() } });
      containerResults.push({ name, action: 'removed' });
    } catch (err) {
      containerResults.push({
        name,
        action: 'failed',
        error: (err as Error).message,
      });
    }
  }

  // Stop mock servers
  const mockResults: CleanResult['mocks'] = [];
  for (const [name, mockInfo] of session.mockServers) {
    try {
      await mockInfo.server.close();
      bus?.emit('clean', { event: 'mock_stopped', data: { type: 'mock_stopped', name, timestamp: Date.now() } });
      mockResults.push({ name, action: 'stopped' });
    } catch (err) {
      mockResults.push({
        name,
        action: 'failed',
        error: (err as Error).message,
      });
    }
  }

  // Remove network (default: keep — safer for repeated setup cycles)
  let networkResult: CleanResult['network'];
  if (params.removeNetwork) {
    try {
      await removeNetwork(networkName);
      bus?.emit('clean', { event: 'network_removed', data: { type: 'network_removed', name: networkName, timestamp: Date.now() } });
      networkResult = { name: networkName, action: 'removed' };
    } catch {
      networkResult = { name: networkName, action: 'failed' };
    }
  } else {
    networkResult = { name: networkName, action: 'kept' };
  }

  // Optionally remove Docker images (default: keep — avoids full rebuild next run)
  const imageResults: CleanResult['images'] = [];
  if (params.removeImages) {
    for (const svc of services) {
      try {
        await execFileAsync('docker', [...getDockerHostArgs(), 'image', 'rm', svc.build.image], { timeout: 30_000 });
        imageResults.push({ name: svc.build.image, action: 'removed' });
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (/No such image/i.test(msg)) {
          imageResults.push({ name: svc.build.image, action: 'not_found' });
        } else {
          imageResults.push({ name: svc.build.image, action: 'failed', error: msg });
        }
      }
    }
  } else {
    for (const svc of services) {
      imageResults.push({ name: svc.build.image, action: 'kept' });
    }
  }

  const cleanDuration = Date.now() - cleanStart;
  bus?.emit('clean', { event: 'clean_end', data: { type: 'clean_end', duration: cleanDuration, timestamp: Date.now() } });
  bus?.emit('activity', {
    event: 'activity_update',
    data: { id: `clean-${cleanStart}`, source: 'ai', operation: 'clean', project: session.config.project.name, status: 'success', startTime: cleanStart, endTime: Date.now() },
  });

  sessionManager.remove(params.projectPath);

  return {
    containers: containerResults,
    mocks: mockResults,
    network: networkResult,
    images: imageResults,
    sessionRemoved: true,
  };
}
