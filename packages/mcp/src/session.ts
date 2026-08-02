/**
 * @module session
 * Per-project session state management for the MCP server.
 *
 * Tracks loaded configuration, running containers, mock servers,
 * and the overall lifecycle state for each project.
 *
 * ## Multi-tenant design (F05 note)
 *
 * Session keys are `clientId:projectPath` to support multi-client isolation.
 * However, the current MCP tool handlers do NOT inject a per-request clientId —
 * they all fall back to {@link SessionManager.DEFAULT_CLIENT}.
 *
 * This means the multi-tenant machinery is correct but dormant.
 * Activating it requires:
 *   1. Reading the client ID from the MCP transport request context
 *      (e.g. `request.meta?.clientId` in Streamable HTTP mode).
 *   2. Passing it through every tool handler call.
 *
 * Until that is done, all sessions share a single "default" namespace and
 * behave as single-tenant. If you need true multi-tenant isolation today,
 * run a separate `npx argusai-mcp` process per client.
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import type { E2EConfig, SSEBus, PortMapping, CircuitBreakerState, HistoryConfig, DrizzleHistoryStoreWithDb } from 'argusai-core';
import type { HistoryStore, KnowledgeStore } from 'argusai-core';
import { CircuitBreaker, createHistoryStore, HistoryRecorder, SQLiteHistoryStore, SQLiteKnowledgeStore, NoopKnowledgeStore, PortAllocator, DrizzleHistoryStore, DrizzleKnowledgeStore, createSqliteDbFromDatabase, loadConfig } from 'argusai-core';

// =====================================================================
// Types
// =====================================================================

export type SessionState = 'initialized' | 'built' | 'running' | 'stopped';

export interface ProjectSession {
  projectPath: string;
  config: E2EConfig;
  configPath: string;
  containerIds: Map<string, string>;
  /** YAML container name → actual Docker container name (namespace-prefixed) */
  containerNames: Map<string, string>;
  /** YAML container name → effective host port bindings (after auto-assignment) */
  containerHostPorts: Map<string, Array<{ host: number; container: number }>>;
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
  /**
   * True when the session was created lazily by {@link SessionManager.ensure}
   * (e.g. a read-only tool) rather than by an explicit `argus_init`. Such
   * sessions can be safely re-initialized by `argus_init`.
   */
  lazy?: boolean;
  /**
   * True when the project has no `service` / `services` definition.
   * In test-only mode, argus_setup skips Docker operations and
   * the session transitions directly from `initialized` to `running`.
   * Fixed at session creation time — do not recompute from config at runtime.
   */
  isTestOnly: boolean;
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
 * 1. `isolation.namespace` — explicit override
 * 2. `network.name` — backward-compatible explicit network name
 * 3. `argusai-<slug>-network` — default project-scoped name
 *
 * The slug lowercases the project name and replaces non-alphanumeric
 * characters with hyphens, so "My App" → "argusai-my-app-network".
 */
export function deriveNetworkName(config: E2EConfig): string {
  if (config.isolation?.namespace) {
    return `argusai-${config.isolation.namespace}-network`;
  }
  const slug = config.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `argusai-${slug}-network`;
}

/**
 * Derive the project namespace string (without -network suffix).
 * Used as a prefix for container names and Docker labels.
 *
 * Also surfaced via {@link resolveContainerName} — every container started by
 * `argus_setup` gets the `<namespace>-<name>` prefix, so concurrent sessions
 * (e.g. per-worktree MCP servers) never collide on Docker container names.
 * The original name is kept as a `--network-alias` for in-network DNS.
 */
export function deriveNamespace(config: E2EConfig): string {
  if (config.isolation?.namespace) {
    return config.isolation.namespace;
  }
  return config.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve the actual Docker container name for a YAML-declared container name.
 * Falls back to the YAML name when the session has no record (e.g. container
 * started outside argus_setup, or test-only sessions).
 */
export function resolveContainerName(session: ProjectSession, yamlName: string): string {
  return session.containerNames.get(yamlName) ?? yamlName;
}

/**
 * Resolve the effective host port for a container's published port.
 *
 * Returns the port actually bound on the host — after PortResolver
 * reassignment and/or Docker random-port allocation (`ports: ["0:8080"]`).
 * Returns `undefined` when the session has no record for this binding.
 */
export function resolveHostPort(
  session: ProjectSession,
  yamlName: string,
  containerPort: number,
): number | undefined {
  return session.containerHostPorts.get(yamlName)?.find(b => b.container === containerPort)?.host;
}
/** Cleanup check interval: every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// =====================================================================
// AsyncSessionMutex — true async per-session mutex using async-mutex.
//
// Replaces the old synchronous SessionMutex which could not protect
// critical sections across await boundaries (e.g. setup + healthcheck).
// Each session key gets its own Mutex instance; concurrent callers
// await the same Mutex and are serialized correctly even across I/O.
// =====================================================================

class AsyncSessionMutex {
  private mutexes = new Map<string, Mutex>();

  private get(key: string): Mutex {
    let m = this.mutexes.get(key);
    if (!m) {
      m = new Mutex();
      this.mutexes.set(key, m);
    }
    return m;
  }

  /**
   * Run `fn` exclusively for `key`. Concurrent callers queue behind the
   * current holder and resume in FIFO order when it releases the lock.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.get(key).runExclusive(fn);
  }

  isLocked(key: string): boolean {
    return this.mutexes.get(key)?.isLocked() ?? false;
  }

  /** Release the mutex map entry after a session is removed. */
  delete(key: string): void {
    this.mutexes.delete(key);
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
  /**
   * In-flight creation promises for `ensure()`.
   * Keyed by the same `clientId:projectPath` string as `sessions`.
   * Prevents concurrent `ensure()` calls from racing to load the same config.
   */
  private ensurePromises = new Map<string, Promise<ProjectSession>>();
  private mutex = new AsyncSessionMutex();
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
   * Ensure a session exists for a project, lazily loading `e2e.yaml` if needed.
   *
   * Unlike {@link getOrThrow}, this does not require a prior `argus_init`. It is
   * intended for read-only / persistence-backed tools (history, trends, flaky,
   * compare, diagnose, patterns, report-fix) that query SQLite and must keep
   * working even after an MCP process restart or TTL expiry — situations where
   * the in-memory session would otherwise be gone, producing SESSION_NOT_FOUND.
   *
   * Plugins are intentionally NOT loaded here; that remains the responsibility
   * of the lifecycle tools via `argus_init`.
   *
   * @throws {SessionError} CONFIG_NOT_FOUND / CONFIG_INVALID when the config
   *   cannot be loaded and no session exists yet.
   */
  async ensure(
    projectPath: string,
    configFile?: string,
    clientId: string = SessionManager.DEFAULT_CLIENT,
  ): Promise<ProjectSession> {
    if (this.has(projectPath, clientId)) {
      return this.getOrThrow(projectPath, clientId);
    }

    const k = this.key(clientId, projectPath);

    // If another concurrent ensure() is already loading this session, await
    // its promise instead of racing to create a duplicate (F07 fix).
    const inflight = this.ensurePromises.get(k);
    if (inflight) return inflight;

    const promise = this._ensureLoad(projectPath, configFile, clientId, k);
    this.ensurePromises.set(k, promise);

    try {
      return await promise;
    } finally {
      this.ensurePromises.delete(k);
    }
  }

  /** Internal: load config and create a lazy session. Called exclusively by ensure(). */
  private async _ensureLoad(
    projectPath: string,
    configFile: string | undefined,
    clientId: string,
    k: string,
  ): Promise<ProjectSession> {
    // Double-check after acquiring: a concurrent ensure() may have finished.
    if (this.sessions.has(k)) {
      return this.sessions.get(k)!;
    }

    const configPath = path.resolve(projectPath, configFile ?? 'e2e.yaml');
    let config: E2EConfig;
    try {
      config = await loadConfig(configPath);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not found')) {
        throw new SessionError('CONFIG_NOT_FOUND', `Configuration file not found: ${configPath}`);
      }
      if (message.includes('validation failed')) {
        throw new SessionError('CONFIG_INVALID', message);
      }
      throw err;
    }

    // Final check after async gap — another caller may have won the race.
    if (this.sessions.has(k)) {
      return this.sessions.get(k)!;
    }

    const session = this.create(projectPath, config, configPath, clientId);
    session.lazy = true;
    return session;
  }

  /**
   * Create a new session for a project.
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

    const networkName = config.network?.name ?? deriveNetworkName(config);
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

        // Prefer the shared raw DB handle (attached by createHistoryStore to
        // both DrizzleHistoryStore and the RemoteHistoryStore wrapper) so the
        // knowledge base stays enabled regardless of which store wraps it.
        const rawDb = (historyStore as Partial<DrizzleHistoryStoreWithDb>).__rawDb;
        if (rawDb) {
          knowledgeStore = new DrizzleKnowledgeStore(createSqliteDbFromDatabase(rawDb));
        } else if (historyStore instanceof DrizzleHistoryStore) {
          knowledgeStore = new NoopKnowledgeStore();
        } else if (historyStore instanceof SQLiteHistoryStore) {
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
      containerNames: new Map(),
      containerHostPorts: new Map(),
      mockServers: new Map(),
      networkName,
      createdAt: now,
      lastAccessedAt: now,
      state: 'initialized',
      clientId,
      runId: randomUUID(),
      activeGuardians: new Map(),
      circuitBreaker,
      historyStore,
      historyRecorder,
      knowledgeStore,
      // Fixed at creation time to avoid re-deriving from config at every run check.
      isTestOnly: !config.service && (!config.services || config.services.length === 0),
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
    this.mutex.delete(k);
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

  /**
   * Run `fn` exclusively for this project, serializing concurrent tool calls.
   *
   * This replaces the old synchronous acquireLock/releaseLock pair, which
   * could not protect critical sections that span multiple await points
   * (e.g. setup's health-check loop). Callers queue and resume in FIFO order.
   *
   * @example
   * ```ts
   * const result = await sessionManager.withLock(projectPath, async () => {
   *   await handleSetupCore(params, session);
   * });
   * ```
   */
  async withLock<T>(
    projectPath: string,
    fn: () => Promise<T>,
    clientId: string = SessionManager.DEFAULT_CLIENT,
  ): Promise<T> {
    return this.mutex.run(this.key(clientId, projectPath), fn);
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
        this.mutex.delete(key);
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
