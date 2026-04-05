/**
 * @module commands/dashboard
 * `preflight dashboard` — Launch the Dashboard UI.
 *
 * Since the dashboard is an independent package (`argusai-dashboard`),
 * this command attempts to spawn the dashboard dev server directly.
 * If that fails it prints manual instructions.
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── ANSI colours ──────────────────────────────────────────────────────
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerDashboard(program: Command): void {
  program
    .command('dashboard')
    .description('启动 Dashboard 可视化面板')
    .option('-p, --port <port>', 'Dashboard 端口', '9091')
    .action(async (opts: { port: string }) => {
      const configPath = program.opts().config as string | undefined;
      const port = opts.port;

      const dashboardDir = path.resolve(__dirname, '../../../dashboard');

      console.log(`\n${BOLD}Preflight Dashboard${RESET}\n`);

      // Attempt to spawn the dashboard process
      try {
        const proc = spawn('pnpm', ['dev', '--port', port], {
          cwd: dashboardDir,
          stdio: 'inherit',
          env: {
            ...process.env,
            ...(configPath ? { E2E_CONFIG: path.resolve(configPath) } : {}),
          },
        });

        proc.on('error', () => {
          printManualInstructions(port, configPath);
        });

        // Keep the process alive
        proc.on('close', (code) => {
          if (code !== 0) {
            printManualInstructions(port, configPath);
          }
        });
      } catch {
        printManualInstructions(port, configPath);
      }
    });
}

function printManualInstructions(port: string, configPath?: string): void {
  console.log(`${RED}Dashboard 包未找到或无法自动启动。${RESET}\n`);
  console.log(`${BOLD}手动启动 Dashboard:${RESET}`);
  console.log(`  ${GREEN}cd packages/dashboard && pnpm dev --port ${port}${RESET}\n`);

  if (configPath) {
    console.log(`${GRAY}提示: 设置 E2E_CONFIG=${path.resolve(configPath)} 环境变量以加载配置${RESET}\n`);
  }
}
