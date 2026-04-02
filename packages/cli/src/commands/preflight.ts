/**
 * @module commands/preflight
 * `argusai preflight` — Run environment health checks.
 */

import { Command } from 'commander';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerPreflight(program: Command): void {
  program
    .command('preflight')
    .description('环境预检健康检查')
    .option('--skip-disk', '跳过磁盘空间检查')
    .option('--skip-orphans', '跳过孤儿资源检查')
    .option('--auto-fix', '自动清理孤儿资源')
    .action(async (opts: { skipDisk?: boolean; skipOrphans?: boolean; autoFix?: boolean }) => {
      const {
        loadConfig,
        PreflightChecker,
        computeOverallHealth,
        OrphanCleaner,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      console.log(`\n${BOLD}Preflight Check — ${config.project.name}${RESET}\n`);

      const checker = new PreflightChecker();
      const checks = [];

      const dockerResult = await checker.checkDockerDaemon();
      checks.push(dockerResult);
      const dockerIcon = dockerResult.status === 'pass' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      console.log(`  ${dockerIcon} Docker daemon: ${dockerResult.status}`);

      if (!opts.skipDisk) {
        const threshold = config.resilience?.preflight?.diskSpaceThreshold ?? '2GB';
        const diskResult = await checker.checkDiskSpace(threshold);
        checks.push(diskResult);
        const diskIcon = diskResult.status === 'pass' ? `${GREEN}✓${RESET}` : diskResult.status === 'warn' ? `${YELLOW}!${RESET}` : `${RED}✗${RESET}`;
        console.log(`  ${diskIcon} Disk space: ${diskResult.status}${diskResult.details ? ` (${JSON.stringify(diskResult.details)})` : ''}`);
      }

      if (!opts.skipOrphans) {
        const runId = Date.now().toString(36);
        const orphanResult = await checker.checkOrphans(config.project.name, runId);
        checks.push(orphanResult);
        const orphanIcon = orphanResult.status === 'pass' ? `${GREEN}✓${RESET}` : `${YELLOW}!${RESET}`;
        console.log(`  ${orphanIcon} Orphan resources: ${orphanResult.status}${orphanResult.details ? ` (${JSON.stringify(orphanResult.details)})` : ''}`);
      }

      const overall = computeOverallHealth(checks);
      const overallColor = overall === 'healthy' ? GREEN : overall === 'degraded' ? YELLOW : RED;

      if (opts.autoFix) {
        const runId = Date.now().toString(36);
        const cleaner = new OrphanCleaner(config.project.name, runId);
        await cleaner.detectAndCleanup();
        console.log(`\n  ${GREEN}✓${RESET} Auto-fix: orphan cleanup completed`);
      }

      console.log(`\n  ${BOLD}Overall:${RESET} ${overallColor}${overall}${RESET}\n`);
    });
}
