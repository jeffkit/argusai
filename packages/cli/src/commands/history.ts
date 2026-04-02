/**
 * @module commands/history
 * `argusai history` — Query historical test run records.
 */

import { Command } from 'commander';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerHistory(program: Command): void {
  program
    .command('history')
    .description('查看历史测试运行记录')
    .option('-n, --limit <count>', '返回记录数量', '20')
    .option('--status <status>', '按状态过滤 (passed|failed)')
    .option('--days <days>', '最近 N 天内的记录')
    .action(async (opts: { limit: string; status?: string; days?: string }) => {
      const { createCliContext } = await import('../cli-context.js');
      const configPath = program.opts().config as string | undefined;

      let ctx;
      try {
        ctx = await createCliContext(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      try {
        if (!ctx.historyStore) {
          console.error(`${RED}History is disabled in project configuration.${RESET}`);
          console.error(`${GRAY}Enable it by adding history.enabled: true in e2e.yaml${RESET}`);
          process.exit(1);
        }

        const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 20, 1), 100);
        const status = opts.status as 'passed' | 'failed' | undefined;
        const days = opts.days ? parseInt(opts.days, 10) : undefined;

        const { runs, total } = ctx.historyStore.getRuns(ctx.config.project.name, {
          limit,
          offset: 0,
          status,
          days,
        });

        if (runs.length === 0) {
          console.log(`\n${GRAY}No test runs found.${RESET}\n`);
          return;
        }

        console.log(`\n${BOLD}Test Run History — ${ctx.config.project.name}${RESET}`);
        console.log(`${GRAY}Showing ${runs.length} of ${total} runs${RESET}\n`);

        console.log(
          `  ${'ID'.padEnd(14)} ${'Status'.padEnd(8)} ${'Passed'.padEnd(8)} ${'Failed'.padEnd(8)} ${'Duration'.padEnd(10)} Date`,
        );
        console.log(`  ${'─'.repeat(70)}`);

        for (const run of runs) {
          const statusStr =
            run.status === 'passed'
              ? `${GREEN}passed${RESET}`
              : `${RED}failed${RESET}`;
          const date = new Date(run.timestamp).toISOString().slice(0, 16).replace('T', ' ');
          const duration = run.duration < 1000
            ? `${run.duration}ms`
            : `${(run.duration / 1000).toFixed(1)}s`;

          console.log(
            `  ${run.id.slice(0, 12).padEnd(14)} ${statusStr.padEnd(8 + (statusStr.length - 6))} ${String(run.passed).padEnd(8)} ${String(run.failed).padEnd(8)} ${duration.padEnd(10)} ${date}`,
          );
        }

        console.log('');
      } finally {
        ctx.close();
      }
    });
}
