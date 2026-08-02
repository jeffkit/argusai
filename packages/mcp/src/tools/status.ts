/**
 * @module tools/status
 * argus_status — Get current status of all managed resources.
 */

import {
  getContainerStatus,
  isPortInUse,
  type ContainerStatus,
} from 'argusai-core';
import { SessionManager } from '../session.js';

export interface StatusResult {
  state: 'initialized' | 'built' | 'running' | 'stopped';
  network: { name: string; exists: boolean };
  services: Array<{
    name: string;
    containerId?: string;
    status: ContainerStatus;
    ports: Array<{ host: number; container: number; accessible: boolean }>;
    health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
    uptime?: number;
  }>;
  mocks: Array<{
    name: string;
    port: number;
    status: 'running' | 'stopped';
    requestCount: number;
  }>;
}

/**
 * Handle the argus_status MCP tool call.
 * Queries live status of containers, network, and mock services.
 *
 * @param params - Tool input with projectPath
 * @param sessionManager - Session store for tracking project state
 * @returns Current status of all managed resources
 * @throws {SessionError} SESSION_NOT_FOUND if not initialized
 */
export async function handleStatus(
  params: { projectPath: string },
  sessionManager: SessionManager,
): Promise<StatusResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  // Check network
  let networkExists = false;
  try {
    const { execFileSync } = await import('node:child_process');
    const result = execFileSync('docker', ['network', 'inspect', session.networkName], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    networkExists = result.length > 0;
  } catch {
    networkExists = false;
  }

  // Check containers
  const services: StatusResult['services'] = [];
  for (const [name, containerId] of session.containerIds) {
    const actualName = session.containerNames.get(name) ?? name;
    const containerStatus = await getContainerStatus(actualName);

    const config = session.config;
    const svcConfig = config.services?.find(s => s.container.name === name)
      ?? (config.service?.container.name === name ? config.service : undefined);

    const portMappings: StatusResult['services'][number]['ports'] = [];
    // Prefer the effective bindings recorded by argus_setup (post PortResolver
    // reassignment / Docker random-port allocation); fall back to YAML values.
    const effectivePorts = session.containerHostPorts.get(name);
    if (effectivePorts) {
      for (const pm of effectivePorts) {
        const accessible = await isPortInUse(pm.host);
        portMappings.push({ host: pm.host, container: pm.container, accessible });
      }
    } else if (svcConfig) {
      for (const portStr of svcConfig.container.ports) {
        const parts = portStr.split(':');
        const host = parseInt(parts[0]!, 10);
        const container = parseInt(parts[1] ?? parts[0]!, 10);
        const accessible = await isPortInUse(host);
        portMappings.push({ host, container, accessible });
      }
    }

    services.push({
      name,
      containerId,
      status: containerStatus,
      ports: portMappings,
    });
  }

  // Check mocks
  const mocks: StatusResult['mocks'] = [];
  for (const [name, mockInfo] of session.mockServers) {
    let requestCount = 0;
    try {
      const resp = await fetch(`http://localhost:${mockInfo.port}/_mock/requests`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json() as { count: number };
        requestCount = data.count;
      }
      mocks.push({ name, port: mockInfo.port, status: 'running', requestCount });
    } catch {
      mocks.push({ name, port: mockInfo.port, status: 'stopped', requestCount: 0 });
    }
  }

  return {
    state: session.state,
    network: { name: session.networkName, exists: networkExists },
    services,
    mocks,
  };
}
