/**
 * @module commands/run
 * `preflight run` — Execute test suites.
 *
 * Steps:
 * 1. Load e2e.yaml
 * 2. Select suites (--suite filter or all)
 * 3. Create runner from registry
 * 4. Execute tests
 * 5. Output report (console/json/html)
 * 6. Persist results to HistoryStore (if history.enabled in config)
 */

import { Command } from 'commander';
import path from 'node:path';

// ── ANSI colours ──────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerRun(program: Command): void {
  program
    .command('run')
    .description('运行测试套件')
    .option('-s, --suite <id>', '指定运行的测试套件 ID')
    .option('--reporter <type>', '报告格式 (console|json|html)', 'console')
    .option('--output <path>', 'HTML 报告输出路径 (配合 --reporter html)')
    .option('--timeout <ms>', '超时时间（毫秒）', '60000')
    .option('--no-history', '跳过历史记录写入')
    .action(async (opts: { suite?: string; reporter: string; output?: string; timeout: string; history: boolean }) => {
      const {
        loadConfig,
        createDefaultRegistry,
        ConsoleReporter,
        JSONReporter,
        HTMLReporter,
        HistoryConfigSchema,
        createHistoryStore,
        HistoryRecorder,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      if (!config.tests?.suites || config.tests.suites.length === 0) {
        console.error(`${RED}No test suites defined in configuration.${RESET}`);
        process.exit(1);
      }

      let suites: Array<{ name: string; id: string; file?: string; runner?: string; command?: string; config?: string }>;
      if (opts.suite) {
        suites = config.tests.suites.filter((s) => s.id === opts.suite);
        if (suites.length === 0) {
          console.error(`${RED}Suite "${opts.suite}" not found.${RESET}`);
          console.error(`Available suites: ${config.tests.suites.map((s) => s.id).join(', ')}`);
          process.exit(1);
        }
      } else {
        suites = config.tests.suites;
      }

      const registry = await createDefaultRegistry();

      const consoleReporter = new ConsoleReporter();
      const exportReporter = opts.reporter === 'json'
        ? new JSONReporter()
        : opts.reporter === 'html'
          ? new HTMLReporter()
          : null;

      console.log(`\n${BOLD}Running ${suites.length} suite(s)...${RESET}\n`);

      const timeout = parseInt(opts.timeout, 10);
      const configDir = configPath ? path.dirname(path.resolve(configPath)) : process.cwd();
      const resolvedConfigPath = configPath ? path.resolve(configPath) : path.resolve(configDir, 'e2e.yaml');
      const runStart = Date.now();

      for (const suite of suites) {
        const runnerId = suite.runner ?? 'yaml';
        const runner = registry.get(runnerId);

        if (!runner) {
          console.error(`${RED}Runner "${runnerId}" not found for suite "${suite.name}".${RESET}`);
          continue;
        }

        const target = suite.command ?? suite.file ?? '';
        const baseUrl = config.service?.vars?.base_url
          ?? `http://localhost:${config.service?.container.ports[0]?.split(':')[0] ?? '8080'}`;
        const env: Record<string, string> = {
          BASE_URL: baseUrl,
          ...(config.service?.container.environment ?? {}),
        };

        const configFile = suite.config
          ? path.resolve(configDir, suite.config)
          : undefined;

        const events = runner.run({
          cwd: configDir,
          target,
          env,
          timeout,
          configVars: config.service?.vars,
          configFile,
        });

        for await (const event of events) {
          consoleReporter.onEvent(event);
          if (exportReporter) exportReporter.onEvent(event);
        }
      }

      const report = (exportReporter ?? consoleReporter).generate();
      report.project = config.project?.name ?? report.project;

      if (opts.reporter === 'json') {
        console.log(JSON.stringify(report, null, 2));
      } else if (opts.reporter === 'html') {
        const outputPath = opts.output ?? 'e2e-report.html';
        await (exportReporter as InstanceType<typeof HTMLReporter>).writeReport(outputPath);
        console.log(
          `\n${BOLD}Summary:${RESET} ` +
          `${GREEN}${report.totals.passed} passed${RESET}, ` +
          `${RED}${report.totals.failed} failed${RESET}, ` +
          `${report.totals.skipped} skipped\n`,
        );
        console.log(`${GREEN}HTML report written to: ${outputPath}${RESET}\n`);
      } else {
        console.log(
          `\n${BOLD}Summary:${RESET} ` +
          `${GREEN}${report.totals.passed} passed${RESET}, ` +
          `${RED}${report.totals.failed} failed${RESET}, ` +
          `${report.totals.skipped} skipped\n`,
        );
      }

      // 7. Persist to HistoryStore
      if (opts.history) {
        try {
          const rawHistory = (config as unknown as Record<string, unknown>)['history'];
          const historyConfig = HistoryConfigSchema.parse(rawHistory ?? {});

          if (historyConfig.enabled) {
            const store = createHistoryStore(historyConfig, configDir);
            const recorder = new HistoryRecorder(store, historyConfig);

            const suiteResults = report.suites.map((s) => ({
              id: s.suite.toLowerCase().replace(/\s+/g, '-'),
              name: s.suite,
              status: (s.failed > 0 ? 'failed' : 'passed') as 'passed' | 'failed',
              duration: s.duration,
              passed: s.passed,
              failed: s.failed,
              skipped: s.skipped,
              cases: s.cases.map((c) => ({
                name: c.name,
                suite: s.suite,
                status: c.status,
                duration: c.duration,
                timestamp: report.timestamp,
                attempts: c.attempts?.map((a, i) => ({
                  attempt: i + 1,
                  passed: a.passed,
                  duration: a.duration,
                })),
                failure: c.status === 'failed' && c.error
                  ? { error: c.error }
                  : undefined,
              })),
            }));

            const result = recorder.recordRun(
              {
                status: report.totals.failed > 0 ? 'failed' : 'passed',
                duration: Date.now() - runStart,
                totals: report.totals,
                suites: suiteResults,
              },
              config.project?.name ?? 'unknown',
              configDir,
              resolvedConfigPath,
              'cli',
            );

            if (result) {
              const flakyCount = result.flakyResults.filter(f => f.isFlaky).length;
              console.log(
                `${GREEN}History recorded:${RESET} run ${result.runRecord.id}` +
                (flakyCount > 0 ? ` (${YELLOW}${flakyCount} flaky${RESET})` : ''),
              );
            }

            store.close();
          }
        } catch (err) {
          console.warn(
            `${YELLOW}History recording failed (non-critical): ${(err as Error).message}${RESET}`,
          );
        }
      }

      if (report.totals.failed > 0) {
        process.exit(1);
      }
    });
}
