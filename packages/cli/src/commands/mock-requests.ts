/**
 * @module commands/mock-requests
 * `argusai mock-requests` — View recorded requests from mock services.
 */

import { Command } from 'commander';

const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerMockRequests(program: Command): void {
  program
    .command('mock-requests')
    .description('查看 Mock 服务录制的请求')
    .option('--mock <name>', '指定 Mock 服务名称')
    .option('--clear', '读取后清空请求日志')
    .action(async (opts: { mock?: string; clear?: boolean }) => {
      const { loadConfig } = await import('argusai-core');
      const configPath = program.opts().config as string | undefined;

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      if (!config.mocks) {
        console.error(`${RED}No mocks configured in e2e.yaml.${RESET}`);
        process.exit(1);
      }

      const targets = opts.mock
        ? [[opts.mock, config.mocks[opts.mock]] as const].filter(([, v]) => v)
        : Object.entries(config.mocks);

      if (targets.length === 0) {
        console.error(`${RED}Mock "${opts.mock}" not found in configuration.${RESET}`);
        process.exit(1);
      }

      console.log(`\n${BOLD}Mock Request Recordings${RESET}\n`);

      for (const [name, mockConfig] of targets) {
        const port = (mockConfig as any).port;
        try {
          const resp = await fetch(`http://localhost:${port}/_mock/requests`, {
            signal: AbortSignal.timeout(5000),
          });

          if (!resp.ok) {
            console.log(`  ${BOLD}${name}${RESET} (port ${port}): ${RED}unavailable${RESET}\n`);
            continue;
          }

          const data = await resp.json() as { count: number; requests: Array<{ method: string; url: string; timestamp: string; body?: unknown }> };

          console.log(`  ${BOLD}${name}${RESET} (port ${port}): ${data.count} requests`);

          if (data.requests.length > 0) {
            for (const req of data.requests) {
              const time = new Date(req.timestamp).toISOString().slice(11, 19);
              console.log(`    ${GRAY}${time}${RESET} ${req.method} ${req.url}`);
            }
          }

          if (opts.clear) {
            await fetch(`http://localhost:${port}/_mock/requests`, {
              method: 'DELETE',
              signal: AbortSignal.timeout(2000),
            });
            console.log(`    ${GRAY}(cleared)${RESET}`);
          }

          console.log('');
        } catch {
          console.log(`  ${BOLD}${name}${RESET} (port ${port}): ${RED}not reachable${RESET}\n`);
        }
      }
    });
}
