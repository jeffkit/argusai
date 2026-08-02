/**
 * @module tools/logs
 * argus_logs — Get recent logs from a container.
 */

import {
  getContainerLogs,
  getContainerStatus,
  type ContainerStatus,
} from 'argusai-core';
import { SessionManager, SessionError } from '../session.js';

export interface LogsResult {
  container: string;
  lines: string[];
  lineCount: number;
  containerStatus: ContainerStatus;
}

/**
 * Handle the argus_logs MCP tool call.
 * Retrieves recent log output from a specific container.
 *
 * @param params - Tool input with projectPath, container name, and optional line count / since filter
 * @param sessionManager - Session store for tracking project state
 * @returns Container logs split into lines with container status
 * @throws {SessionError} CONTAINER_NOT_FOUND if container not in session, CONTAINER_NOT_RUNNING if stopped
 */
export async function handleLogs(
  params: { projectPath: string; container: string; lines?: number; since?: string },
  sessionManager: SessionManager,
): Promise<LogsResult> {
  const session = sessionManager.getOrThrow(params.projectPath);

  if (!session.containerIds.has(params.container)) {
    throw new SessionError('CONTAINER_NOT_FOUND', `Container "${params.container}" not found in session`);
  }

  // Resolve the YAML-declared name to the actual namespace-prefixed name.
  const container = session.containerNames.get(params.container) ?? params.container;

  const containerStatus = await getContainerStatus(container);

  if (containerStatus !== 'running' && containerStatus !== 'exited') {
    throw new SessionError('CONTAINER_NOT_RUNNING', `Container "${params.container}" is not running (status: ${containerStatus})`);
  }

  const lineCount = params.lines ?? 100;
  const rawLogs = await getContainerLogs(container, lineCount);
  const lines = rawLogs.split('\n').filter(Boolean);

  return {
    container,
    lines,
    lineCount: lines.length,
    containerStatus,
  };
}
