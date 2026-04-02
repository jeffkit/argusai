/**
 * @module commands/compare
 * `argusai compare` — Compare two test runs side-by-side.
 */

import { Command } from 'commander';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerCompare(program: Command): void {
  program
    .command('compare')
    .description('对比两次测试运行的差异')
    .requiredOption('--base <id>', '基准运行 ID')
    .requiredOption('--target <id>', '对比运行 ID')
    .action(async (opts: { base: string; target: string }) => {
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
          process.exit(1);
        }

        const baseData = ctx.historyStore.getRunById(opts.base);
        if (!baseData) {
          console.error(`${RED}Base run not found: ${opts.base}${RESET}`);
          process.exit(1);
        }

        const targetData = ctx.historyStore.getRunById(opts.target);
        if (!targetData) {
          console.error(`${RED}Target run not found: ${opts.target}${RESET}`);
          process.exit(1);
        }

        const baseCases = new Map(baseData.cases.map(c => [c.caseName, c]));
        const targetCases = new Map(targetData.cases.map(c => [c.caseName, c]));

        const newFailures: string[] = [];
        const fixed: string[] = [];
        const consistent = { passed: 0, failed: 0, skipped: 0 };
        const newCases: string[] = [];
        const removedCases: string[] = [];

        for (const [name, tc] of targetCases) {
          const bc = baseCases.get(name);
          if (!bc) { newCases.push(name); continue; }
          if (bc.status !== 'failed' && tc.status === 'failed') newFailures.push(name);
          else if (bc.status === 'failed' && tc.status === 'passed') fixed.push(name);
          else if (tc.status === 'passed') consistent.passed++;
          else if (tc.status === 'failed') consistent.failed++;
          else consistent.skipped++;
        }

        for (const name of baseCases.keys()) {
          if (!targetCases.has(name)) removedCases.push(name);
        }

        console.log(`\n${BOLD}Run Comparison${RESET}`);
        console.log(`  Base:   ${opts.base.slice(0, 12)} (${baseData.run.status})`);
        console.log(`  Target: ${opts.target.slice(0, 12)} (${targetData.run.status})\n`);

        if (newFailures.length > 0) {
          console.log(`  ${RED}${BOLD}New Failures (${newFailures.length}):${RESET}`);
          for (const name of newFailures) console.log(`    ${RED}✗${RESET} ${name}`);
          console.log('');
        }

        if (fixed.length > 0) {
          console.log(`  ${GREEN}${BOLD}Fixed (${fixed.length}):${RESET}`);
          for (const name of fixed) console.log(`    ${GREEN}✓${RESET} ${name}`);
          console.log('');
        }

        console.log(`  ${BOLD}Consistent:${RESET} ${GREEN}${consistent.passed} passed${RESET}, ${RED}${consistent.failed} failed${RESET}, ${GRAY}${consistent.skipped} skipped${RESET}`);

        if (newCases.length > 0) console.log(`  ${BOLD}New cases:${RESET} ${newCases.length}`);
        if (removedCases.length > 0) console.log(`  ${BOLD}Removed cases:${RESET} ${removedCases.length}`);

        console.log('');
      } finally {
        ctx.close();
      }
    });
}
