/**
 * @module commands/trends
 * `argusai trends` — View trend data for pass-rate, duration, or flaky metrics.
 */

import { Command } from 'commander';
import type { TestRunRecord, TrendDataPoint } from 'argusai-core';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function aggregateByDay(runs: TestRunRecord[], metric: 'pass-rate' | 'duration' | 'flaky'): TrendDataPoint[] {
  const dayMap = new Map<string, TestRunRecord[]>();
  for (const run of runs) {
    const date = new Date(run.timestamp).toISOString().slice(0, 10);
    const existing = dayMap.get(date) ?? [];
    existing.push(run);
    dayMap.set(date, existing);
  }

  const points: TrendDataPoint[] = [];
  for (const date of [...dayMap.keys()].sort()) {
    const dayRuns = dayMap.get(date)!;
    let value: number;
    switch (metric) {
      case 'pass-rate': {
        const total = dayRuns.reduce((s, r) => s + r.passed + r.failed + r.skipped, 0);
        const passed = dayRuns.reduce((s, r) => s + r.passed, 0);
        value = total > 0 ? (passed / total) * 100 : 0;
        break;
      }
      case 'duration': {
        value = dayRuns.reduce((s, r) => s + r.duration, 0) / dayRuns.length;
        break;
      }
      case 'flaky': {
        value = dayRuns.reduce((s, r) => s + r.flaky, 0);
        break;
      }
    }
    points.push({ date, value: Math.round(value * 100) / 100, runCount: dayRuns.length });
  }
  return points;
}

export function registerTrends(program: Command): void {
  program
    .command('trends')
    .description('查看测试趋势分析')
    .requiredOption('-m, --metric <type>', '指标类型 (pass-rate|duration|flaky)')
    .option('-d, --days <days>', '分析最近 N 天', '14')
    .option('-s, --suite <id>', '按套件 ID 过滤')
    .action(async (opts: { metric: string; days: string; suite?: string }) => {
      const { createCliContext } = await import('../cli-context.js');
      const configPath = program.opts().config as string | undefined;

      const metric = opts.metric as 'pass-rate' | 'duration' | 'flaky';
      if (!['pass-rate', 'duration', 'flaky'].includes(metric)) {
        console.error(`${RED}Invalid metric: ${opts.metric}. Use pass-rate, duration, or flaky.${RESET}`);
        process.exit(1);
      }

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

        const days = Math.min(Math.max(parseInt(opts.days, 10) || 14, 1), 90);
        const now = Date.now();
        const fromMs = now - days * 24 * 60 * 60 * 1000;

        const runs = ctx.historyStore.getRunsInDateRange(ctx.config.project.name, fromMs, now);

        const dataPoints = aggregateByDay(runs, metric);

        const metricLabel = metric === 'pass-rate' ? 'Pass Rate (%)' : metric === 'duration' ? 'Duration (ms)' : 'Flaky Count';
        console.log(`\n${BOLD}Trends — ${metricLabel} — ${ctx.config.project.name}${RESET}`);
        console.log(`${GRAY}Period: last ${days} days | ${runs.length} total runs${RESET}\n`);

        if (dataPoints.length === 0) {
          console.log(`  ${GRAY}No data points available.${RESET}\n`);
          return;
        }

        console.log(`  ${'Date'.padEnd(12)} ${'Value'.padEnd(12)} Runs`);
        console.log(`  ${'─'.repeat(35)}`);

        for (const dp of dataPoints) {
          const valueStr = metric === 'pass-rate' ? `${dp.value}%` : String(dp.value);
          console.log(`  ${dp.date.padEnd(12)} ${valueStr.padEnd(12)} ${dp.runCount}`);
        }

        if (dataPoints.length >= 2) {
          const current = dataPoints[dataPoints.length - 1]!.value;
          const previous = dataPoints[dataPoints.length - 2]!.value;
          const change = previous !== 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : 0;
          const arrow = change > 0 ? `${GREEN}↑${RESET}` : change < 0 ? `${RED}↓${RESET}` : '→';
          console.log(`\n  ${BOLD}Latest:${RESET} ${current} ${arrow} ${change > 0 ? '+' : ''}${change}% from previous`);
        }

        console.log('');
      } finally {
        ctx.close();
      }
    });
}
