/**
 * @module cli-context
 * One-shot context for CLI commands that need history/knowledge stores.
 *
 * Unlike the MCP SessionManager (which maintains persistent sessions),
 * CLI context opens stores for a single command invocation and closes
 * them when done.
 */

import path from 'node:path';
import type { E2EConfig, HistoryConfig, HistoryStore, KnowledgeStore } from 'argusai-core';
import {
  loadConfig,
  createHistoryStore,
  SQLiteHistoryStore,
  SQLiteKnowledgeStore,
  NoopKnowledgeStore,
} from 'argusai-core';

export interface CliContext {
  config: E2EConfig;
  projectPath: string;
  historyStore?: HistoryStore;
  knowledgeStore?: KnowledgeStore;
  close(): void;
}

/**
 * Create a CLI context by loading config and opening stores.
 * Caller is responsible for calling `ctx.close()` when done.
 */
export async function createCliContext(configPath?: string): Promise<CliContext> {
  const config = await loadConfig(configPath);
  const projectPath = configPath ? path.dirname(path.resolve(configPath)) : process.cwd();

  let historyStore: HistoryStore | undefined;
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

      if (historyStore instanceof SQLiteHistoryStore) {
        knowledgeStore = new SQLiteKnowledgeStore(historyStore.getDatabase());
      } else {
        knowledgeStore = new NoopKnowledgeStore();
      }
    } catch {
      // Graceful degradation: history init failure is non-critical
    }
  }

  return {
    config,
    projectPath,
    historyStore,
    knowledgeStore,
    close() {
      try { knowledgeStore?.close(); } catch { /* ignore */ }
      try { historyStore?.close(); } catch { /* ignore */ }
    },
  };
}
