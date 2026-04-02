/**
 * @module commands/diagnose
 * `argusai diagnose` — Diagnose a failed test case.
 */

import { Command } from 'commander';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerDiagnose(program: Command): void {
  program
    .command('diagnose')
    .description('诊断失败的测试用例')
    .requiredOption('--run <id>', '测试运行 ID')
    .requiredOption('--case <name>', '失败的测试用例名称')
    .action(async (opts: { run: string; case: string }) => {
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
          console.error(`${RED}History/knowledge base is disabled in project configuration.${RESET}`);
          process.exit(1);
        }

        const runData = ctx.historyStore.getRunById(opts.run);
        if (!runData) {
          console.error(`${RED}Test run '${opts.run}' not found in history.${RESET}`);
          process.exit(1);
        }

        const testCase = runData.cases.find(c => c.caseName === opts.case);
        if (!testCase) {
          console.error(`${RED}Case '${opts.case}' not found in run '${opts.run}'.${RESET}`);
          process.exit(1);
        }

        if (testCase.status !== 'failed') {
          console.error(`${RED}Case '${opts.case}' did not fail (status: ${testCase.status}).${RESET}`);
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
        if (statusMatch) {
          event.status = parseInt(statusMatch[1]!, 10);
        }

        const classifier = createDefaultClassifier();
        const engine = new DiagnosticsEngine(classifier, ctx.knowledgeStore);
        const result = await engine.diagnose(event);

        console.log(`\n${BOLD}Diagnosis — ${testCase.caseName}${RESET}\n`);

        console.log(`  ${BOLD}Category:${RESET}    ${result.category}`);
        console.log(`  ${BOLD}Error:${RESET}       ${testCase.error?.slice(0, 100) ?? 'N/A'}`);

        if (result.pattern) {
          const p = result.pattern;
          const conf = result.confidence ?? 0;
          const confColor = conf > 0.7 ? GREEN : conf > 0.3 ? YELLOW : RED;
          console.log(`\n  ${BOLD}Matched Pattern:${RESET}`);
          console.log(`    Description: ${p.description}`);
          console.log(`    Confidence:  ${confColor}${(conf * 100).toFixed(0)}%${RESET}`);
          if (result.suggestedFix) {
            console.log(`    Suggested:   ${GREEN}${result.suggestedFix}${RESET}`);
          }
        } else {
          console.log(`\n  ${GRAY}No matching pattern found in knowledge base.${RESET}`);
        }

        console.log('');
      } finally {
        ctx.close();
      }
    });
}
