/**
 * @module session
 * Per-project session state management for the MCP server.
 *
 * Tracks loaded configuration, running containers, mock servers,
 * and the overall lifecycle state for each project.
 *
 * Multi-tenant: session keys are `clientId:projectPath` so different
 * clients can independently manage the same project. Includes TTL-based
 * auto-cleanup and per-session mutex.
 */

import type { E2EConfig, SSEBus, PortMapping, CircuitBreakerState, HistoryConfig, WorktreeInfo } from 'argusai-core';
import type { HistoryStore, KnowledgeStore } from 'argusai-core';
import { CircuitBreaker, createHistoryStore, HistoryRecorder, SQLiteHistoryStore, SQLiteKnowledgeStore, NoopKnowledgeStore, PortAllocator, detectWorktree } from 'argusai-core';

// =====================================================================
// Types
// =====================================================================

export type SessionState = 'initialized' | 'built' | 'running' | 'stopped';

export interface ProjectSession {
  projectPath: string;
  config: E2EConfig;
  configPath: string;
  containerIds: Map<string, string>;
  mockServers: Map<string, { server: { close(): Promise<void> }; port: number }>;
  networkName: string;
  createdAt: number;
  lastAccessedAt: number;
  state: SessionState;
  /** Client identifier for multi-tenant isolation */
  clientId: string;
  /** Unique run identifier used for Docker labels (per session init) */
  runId: string;
  /** Active container guardians keyed by container name */
  activeGuardians: Map<string, unknown>;
  /** Port mappings from auto-resolution during setup */
  portMappings?: PortMapping[];
  /** Circuit breaker instance for Docker operations */
  circuitBreaker?: CircuitBreaker;
  /** History store for test result persistence */
  historyStore?: HistoryStore;
  /** History recorder for post-run persistence */
  historyRecorder?: HistoryRecorder;
  /** Knowledge store for failure pattern diagnostics */
  knowledgeStore?: KnowledgeStore;
  /** Git worktree info (if running inside a linked worktree) */
  worktreeInfo?: WorktreeInfo;
}

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  initialized: ['built', 'running', 'stopped'],
  built: ['running', 'stopped'],
  running: ['stopped'],
  stopped: ['initialized'],
};

/** Default session TTL: 2 hours of inactivity */
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

// =====================================================================
// Namespace helpers
// =====================================================================

/**
 * Derive a Docker-safe network name for a project.
 *
 * Priority:
 * 1. `isolation.namespace` — explicit override (worktree suffix still appended)
 * 2. `network.name` — backward-compatible explicit network name (no worktree suffix)
 * 3. `argusai-<slug>[-<worktree>]-network` — default project-scoped name
 *
 * When running inside a git worktree, a suffix derived from the branch name
 * is automatically appended to ensure Docker resource isolation across worktrees.
 */
export function deriveNetworkName(config: E2EConfig, worktreeInfo?: WorktreeInfo): string {
  if (config.network?.name && !worktreeInfo?.isWorktree) {
    return config.network.name;
  }

  const base = deriveNamespace(config, worktreeInfo);
  return `argusai-${base}-network`;
}

/**
 * Derive the project namespace string (without -network suffix).
 * Used as a prefix for container names and Docker labels.
 *
 * When inside a worktree, appends the branch slug for isolation.
 */
export function deriveNamespace(config: E2EConfig, worktreeInfo?: WorktreeInfo): string {
  const projectSlug = config.isolation?.namespace
    ?? config.project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  if (worktreeInfo?.isWorktree && worktreeInfo.slug) {
    return `${projectSlug}-${worktreeInfo.slug}`;
  }

  return projectSlug;
}
/** Cleanup check interval: every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// =====================================================================
// SessionMutex — prevents concurrent operations on the same session
// =====================================================================

class SessionMutex {
  private locks = new Map<string, { holder: string; acquired: number }>();

  acquire(key: string, operation: string): void {
    const existing = this.locks.get(key);
    if (existing) {
      throw new SessionError(
        'INVALID_STATE',
        `Concurrent operation rejected: "${operation}" cannot run while "${existing.holder}" is in progress`,
      );
    }
    this.locks.set(key, { holder: operation, acquired: Date.now() });
  }

  release(key: string): void {
    this.locks.delete(key);
  }

  isLocked(key: string): boolean {
    return this.locks.has(key);
  }
}

// =====================================================================
// SessionManager
// =====================================================================

export interface SessionManagerOptions {
  eventBus?: SSEBus;
  /** Session TTL in milliseconds (default: 2 hours) */
  ttlMs?: number;
  /** Enable automatic cleanup of expired sessions */
  autoCleanup?: boolean;
}

export class SessionManager {
  private sessions = new Map<string, ProjectSession>();
  private mutex = new SessionMutex();
  private ttlMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  public eventBus?: SSEBus;

  constructor(eventBusOrOptions?: SSEBus | SessionManagerOptions) {
    if (eventBusOrOptions && 'emit' in eventBusOrOptions) {
      // Backward compat: called with just an EventBus
      this.eventBus = eventBusOrOptions;
      this.ttlMs = DEFAULT_TTL_MS;
    } else if (eventBusOrOptions) {
      this.eventBus = eventBusOrOptions.eventBus;
      this.ttlMs = eventBusOrOptions.ttlMs ?? DEFAULT_TTL_MS;
      if (eventBusOrOptions.autoCleanup !== false) {
        this.startCleanup();
      }
    } else {
      this.ttlMs = DEFAULT_TTL_MS;
    }
  }

  /** Build the composite session key. */
  private key(clientId: string, projectPath: string): string {
    return `${clientId}:${projectPath}`;
  }

  /** Default client ID for single-tenant (stdio) mode. */
  static readonly DEFAULT_CLIENT = 'default';

  /**
   * Check whether a session exists for the given project.
   * Falls back to default client if clientId is not provided.
   */
  has(projectPath: string, clientId: string = SessionManager.DEFAULT_CLIENT): boolean {
    return this.sessions.has(this.key(clientId, projectPath));
  }

  /**
   * Retrieve an existing session or throw SESSION_NOT_FOUND.
   */
  getOrThrow(projectPath: string, clientId: string = SessionManager.DEFAULT_CLIENT): ProjectSession {
    const k = this.key(clientId, projectPath);
    const session = this.sessions.get(k);
    if (!session) {
      throw new SessionError('SESSION_NOT_FOUND', `No active session for project: ${projectPath} (client: ${clientId})`);
    }
    session.lastAccessedAt = Date.now();
    return session;
  }

  /**
   * Create a new session for a project.
   * Automatically detects git worktree context for environment isolation.
   */
  create(
    projectPath: string,
    config: E2EConfig,
    configPath: string,
    clientId: string = SessionManager.DEFAULT_CLIENT,
  ): ProjectSession {
    const k = this.key(clientId, projectPath);
    if (this.sessions.has(k)) {
      throw new SessionError('SESSION_EXISTS', `Session already exists for project: ${projectPath} (client: ${clientId})`);
    }

    const worktreeInfo = detectWorktree(projectPath);
    const networkName = deriveNetworkName(config, worktreeInfo);
    const now = Date.now();

    const cbConfig = config.resilience?.circuitBreaker;
    const circuitBreaker = cbConfig?.enabled !== false
      ? new CircuitBreaker(
          cbConfig?.failureThreshold ?? 5,
          cbConfig?.resetTimeoutMs ?? 30_000,
          this.eventBus,
        )
      : undefined;

    let historyStore: HistoryStore | undefined;
    let historyRecorder: HistoryRecorder | undefined;
    let knowledgeStore: KnowledgeStore | undefined;

    const historyConfig = config.history as HistoryConfig | undefined;
    if (historyConfig?.enabled !== false) {
      try {
        const effectiveConfig: HistoryConfig = historyConfig ?? {
          enabled: true,
          storage: 'local',
          retention: { maxAge: '90d', maxRuns: 1000 },
          flakyWindow: 10,
        };
        historyStore = createHistoryStore(effectiveConfig, projectPath);
        historyRecorder = new HistoryRecorder(historyStore, effectiveConfig);

        if (historyStore instanceof SQLiteHistoryStore) {
          knowledgeStore = new SQLiteKnowledgeStore(historyStore.getDatabase());
        } else {
          knowledgeStore = new NoopKnowledgeStore();
        }
      } catch {
        // Graceful degradation: history init failure is non-critical
      }
    }

    const session: ProjectSession = {
      projectPath,
      config,
      configPath,
      containerIds: new Map(),
      mockServers: new Map(),
      networkName,
      createdAt: now,
      lastAccessedAt: now,
      state: 'initialized',
      clientId,
      runId: Date.now().toString(36),
      activeGuardians: new Map(),
      circuitBreaker,
      historyStore,
      historyRecorder,
      knowledgeStore,
      worktreeInfo: worktreeInfo.isWorktree ? worktreeInfo : undefined,
    };

    this.sessions.set(k, session);
    return session;
  }

  /**
   * Remove a session and release any held lock and port allocations.
   */
  remove(projectPath: string, clientId: string = SessionManager.DEFAULT_CLIENT): void {
    const k = this.key(clientId, projectPath);
    const session = this.sessions.get(k);
    if (session) {
      PortAllocator.instance.releaseSession(session.runId);
    }
    this.mutex.release(k);
    this.sessions.delete(k);
  }

  /**
   * Transition a session to a new state, validating the state machine.
   */
  transition(projectPath: string, newState: SessionState, clientId: string = SessionManager.DEFAULT_CLIENT): void {
    const session = this.getOrThrow(projectPath, clientId);
    const allowed = VALID_TRANSITIONS[session.state];
    if (!allowed.includes(newState)) {
      throw new SessionError(
        'INVALID_STATE',
        `Cannot transition from "${session.state}" to "${newState}"`,
      );
    }
    session.state = newState;
  }

  acquireLock(projectPath: string, operation: string, clientId: string = SessionManager.DEFAULT_CLIENT): void {
    this.mutex.acquire(this.key(clientId, projectPath), operation);
  }

  releaseLock(projectPath: string, clientId: string = SessionManager.DEFAULT_CLIENT): void {
    this.mutex.release(this.key(clientId, projectPath));
  }

  isLocked(projectPath: string, clientId: string = SessionManager.DEFAULT_CLIENT): boolean {
    return this.mutex.isLocked(this.key(clientId, projectPath));
  }

  // =====================================================================
  // Multi-tenant helpers
  // =====================================================================

  /** List all active sessions. */
  listSessions(): ProjectSession[] {
    return [...this.sessions.values()];
  }

  /** List sessions for a specific client. */
  listClientSessions(clientId: string): ProjectSession[] {
    return [...this.sessions.values()].filter(s => s.clientId === clientId);
  }

  /** Get total number of active sessions. */
  get size(): number {
    return this.sessions.size;
  }

  // =====================================================================
  // TTL / Auto-cleanup
  // =====================================================================

  /** Start the periodic cleanup timer. */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /** Stop the periodic cleanup timer. */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /** Remove sessions that haven't been accessed within the TTL period. */
  cleanupExpired(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, session] of this.sessions) {
      if (now - session.lastAccessedAt > this.ttlMs) {
        // Best-effort cleanup of mock servers and port allocations
        for (const [, mock] of session.mockServers) {
          mock.server.close().catch(() => {});
        }
        PortAllocator.instance.releaseSession(session.runId);
        this.mutex.release(key);
        this.sessions.delete(key);
        expired.push(key);
      }
    }

    if (expired.length > 0) {
      this.eventBus?.emit('activity', {
        event: 'sessions_cleaned',
        data: { expired, remaining: this.sessions.size },
      });
    }

    return expired;
  }

  /** Destroy the manager: cleanup all sessions and stop the timer. */
  destroy(): void {
    this.stopCleanup();
    for (const [, session] of this.sessions) {
      for (const [, mock] of session.mockServers) {
        mock.server.close().catch(() => {});
      }
      PortAllocator.instance.releaseSession(session.runId);
      session.activeGuardians.clear();
      try { session.knowledgeStore?.close(); } catch { /* ignore */ }
      try { session.historyStore?.close(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }
}

// =====================================================================
// Error Type
// =====================================================================

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}
