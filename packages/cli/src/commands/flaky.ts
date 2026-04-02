/**
 * @module commands/flaky
 * `argusai flaky` — List flaky (unstable) test cases.
 */

import { Command } from 'commander';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function stabilityColor(level: string): string {
  switch (level) {
    case 'STABLE': return `${GREEN}${level}${RESET}`;
    case 'MOSTLY_STABLE': return `${GREEN}${level}${RESET}`;
    case 'FLAKY': return `${YELLOW}${level}${RESET}`;
    case 'VERY_FLAKY': return `${RED}${level}${RESET}`;
    case 'BROKEN': return `${RED}${level}${RESET}`;
    default: return level;
  }
}

export function registerFlaky(program: Command): void {
  program
    .command('flaky')
    .description('检测 Flaky（不稳定）测试')
    .option('-n, --top <count>', '显示前 N 个最不稳定的用例', '10')
    .option('--min-score <score>', '最低 flaky 分数阈值', '0.01')
    .option('-s, --suite <id>', '按套件 ID 过滤')
    .action(async (opts: { top: string; minScore: string; suite?: string }) => {
      const { createCliContext } = await import('../cli-context.js');
      const { FlakyDetector } = await import('argusai-core');
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
          process.exit(1);
        }

        const topN = Math.min(Math.max(parseInt(opts.top, 10) || 10, 1), 50);
        const minScore = parseFloat(opts.minScore) || 0.01;

        const historyConfig = ctx.config.history as { flakyWindow?: number } | undefined;
        const flakyWindow = historyConfig?.flakyWindow ?? 10;

        const detector = new FlakyDetector(ctx.historyStore, flakyWindow);
        const cases = detector.analyzeAll(ctx.config.project.name, {
          topN,
          minScore,
          suiteId: opts.suite,
        });

        const totalFlaky = cases.filter(c => c.isFlaky).length;

        console.log(`\n${BOLD}Flaky Test Report — ${ctx.config.project.name}${RESET}`);
        console.log(`${GRAY}Window size: ${flakyWindow} runs | Found: ${totalFlaky} flaky tests${RESET}\n`);

        if (cases.length === 0) {
          console.log(`  ${GREEN}No flaky tests detected!${RESET}\n`);
          return;
        }

        console.log(
          `  ${'Case'.padEnd(40)} ${'Score'.padEnd(8)} ${'Stability'.padEnd(16)} Suite`,
        );
        console.log(`  ${'─'.repeat(75)}`);

        for (const c of cases) {
          const name = c.caseName.length > 38 ? c.caseName.slice(0, 35) + '...' : c.caseName;
          const score = c.score.toFixed(2);
          const stability = stabilityColor(c.level);
          const suite = c.suiteId ?? '-';
          console.log(
            `  ${name.padEnd(40)} ${score.padEnd(8)} ${stability.padEnd(16 + (stability.length - c.level.length))} ${suite}`,
          );
        }

        console.log('');
      } finally {
        ctx.close();
      }
    });
}
