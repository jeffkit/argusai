/**
 * @module commands/report-fix
 * `argusai report-fix` — Report a fix to update the knowledge base.
 */

import { Command } from 'commander';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerReportFix(program: Command): void {
  program
    .command('report-fix')
    .description('报告修复结果，更新知识库')
    .requiredOption('--run <id>', '测试运行 ID')
    .requiredOption('--case <name>', '修复的测试用例名称')
    .requiredOption('--fix <desc>', '修复描述')
    .option('--failed', '标记修复失败')
    .action(async (opts: { run: string; case: string; fix: string; failed?: boolean }) => {
      const { createCliContext } = await import('../cli-context.js');
      const { createDefaultClassifier, DiagnosticsEngine } = await import('argusai-core');
      const configPath = program.opts().config as string | undefined;

      let ctx;
      try {
        ctx = await createCliContext(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      try {
        if (!ctx.historyStore || !ctx.knowledgeStore) {
          console.error(`${RED}History/knowledge base is disabled.${RESET}`);
          process.exit(1);
        }

        const runData = ctx.historyStore.getRunById(opts.run);
        if (!runData) {
          console.error(`${RED}Test run '${opts.run}' not found.${RESET}`);
          process.exit(1);
        }

        const testCase = runData.cases.find(c => c.caseName === opts.case);
        if (!testCase) {
          console.error(`${RED}Case '${opts.case}' not found in run '${opts.run}'.${RESET}`);
          process.exit(1);
        }

        const event = {
          runId: opts.run,
          caseName: testCase.caseName,
          suiteId: testCase.suiteId,
          error: testCase.error ?? '',
          status: null as number | null,
          containerStatus: null,
          oomKilled: false,
          diagnostics: null,
        };

        const statusMatch = testCase.error?.match(/\b([45]\d{2})\b/);
        if (statusMatch) event.status = parseInt(statusMatch[1]!, 10);

        const classifier = createDefaultClassifier();
        const engine = new DiagnosticsEngine(classifier, ctx.knowledgeStore);
        const success = !opts.failed;
        const result = await engine.reportFix(event, opts.fix, success);

        console.log(`\n${BOLD}Fix Reported${RESET}\n`);
        console.log(`  Case:        ${opts.case}`);
        console.log(`  Run:         ${opts.run.slice(0, 12)}`);
        console.log(`  Success:     ${success ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`}`);
        console.log(`  Description: ${opts.fix}`);
        console.log(`  Pattern ID:  ${result.patternId}`);
        console.log(`  Confidence:  ${(result.updatedConfidence * 100).toFixed(0)}% (was ${result.previousConfidence !== null ? (result.previousConfidence * 100).toFixed(0) + '%' : 'N/A'})`);
        console.log(`  New pattern: ${result.isNewPattern ? 'yes' : 'no'}`);

        console.log('');
      } finally {
        ctx.close();
      }
    });
}
