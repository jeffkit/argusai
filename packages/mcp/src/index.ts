#!/usr/bin/env node
/**
 * @module argusai-mcp
 * MCP Server entry point — supports both stdio and HTTP transport modes.
 *
 * Usage:
 *   preflight-mcp                    # stdio mode (default, for Cursor/Claude Code)
 *   preflight-mcp --mode http        # HTTP mode (for remote clients, CI)
 *   preflight-mcp --mode http --port 3100 --api-key <key>
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export { createServer } from './server.js';
export type { CreateServerOptions, PlatformServices } from './server.js';
export { SessionManager, SessionError } from './session.js';
export type { ProjectSession, SessionState, SessionManagerOptions } from './session.js';
export { ResultFormatter, generateSummary } from './formatters/result-formatter.js';
export { startHttpTransport, createFastifyMcpHandler } from './transports/http-transport.js';
export type { HttpTransportOptions } from './transports/http-transport.js';
export type { InitResult } from './tools/init.js';
export type { BuildResult } from './tools/build.js';
export type { SetupResult } from './tools/setup.js';
export type { RunResult } from './tools/run.js';
export type { StatusResult } from './tools/status.js';
export type { LogsResult } from './tools/logs.js';
export type { CleanResult } from './tools/clean.js';
export type { MockRequestsResult } from './tools/mock-requests.js';

export const VERSION = '0.1.0';

function parseArgs(argv: string[]): { mode: 'stdio' | 'http'; port: number; host: string; apiKey?: string } {
  let mode: 'stdio' | 'http' = 'stdio';
  let port = 3100;
  let host = '0.0.0.0';
  let apiKey: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      mode = argv[++i] as 'stdio' | 'http';
    } else if (arg === '--port' && argv[i + 1]) {
      port = parseInt(argv[++i]!, 10);
    } else if (arg === '--host' && argv[i + 1]) {
      host = argv[++i]!;
    } else if (arg === '--api-key' && argv[i + 1]) {
      apiKey = argv[++i];
    }
  }

  // Also check env vars
  if (process.env.MCP_MODE === 'http') mode = 'http';
  if (process.env.MCP_PORT) port = parseInt(process.env.MCP_PORT, 10);
  if (process.env.MCP_HOST) host = process.env.MCP_HOST;
  if (process.env.MCP_API_KEY) apiKey = process.env.MCP_API_KEY;

  return { mode, port, host, apiKey };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { server } = createServer();

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // Best-effort shutdown
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (args.mode === 'http') {
    const { startHttpTransport } = await import('./transports/http-transport.js');
    const { close } = await startHttpTransport(server, {
      port: args.port,
      host: args.host,
      apiKey: args.apiKey,
      cors: true,
    });

    console.error(`argusai-mcp HTTP server running on http://${args.host}:${args.port}/mcp`);
    if (args.apiKey) {
      console.error('  Authentication: API key required (Authorization: Bearer <key>)');
    }

    process.on('SIGINT', async () => { await close(); process.exit(0); });
    process.on('SIGTERM', async () => { await close(); process.exit(0); });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// Detect whether this module is the entry point. Must handle npm-linked
// installs where process.argv[1] is a symlink path but import.meta.url
// resolves to the realpath — compare via realpathSync, not raw endsWith.
const isMainModule = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url.endsWith(argv1.replace(/\\/g, '/'))
      || argv1.endsWith('preflight-mcp');
  }
})();
if (isMainModule) {
  main().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
