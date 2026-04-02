/**
 * @module commands/patterns
 * `argusai patterns` — Browse failure patterns in the knowledge base.
 */

import { Command } from 'commander';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerPatterns(program: Command): void {
  program
    .command('patterns')
    .description('浏览失败模式知识库')
    .option('--category <cat>', '按失败类别过滤')
    .option('--source <src>', '按来源过滤 (built-in|learned)')
    .option('--sort <field>', '排序字段 (confidence|occurrences|lastSeen)', 'occurrences')
    .action(async (opts: { category?: string; source?: string; sort: string }) => {
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
        if (!ctx.knowledgeStore) {
          console.error(`${RED}Knowledge base is disabled in project configuration.${RESET}`);
          process.exit(1);
        }

        let patterns = opts.category
          ? ctx.knowledgeStore.findByCategory(opts.category as any)
          : ctx.knowledgeStore.getAllPatterns();

        if (opts.source) {
          patterns = patterns.filter(p => p.source === opts.source);
        }

        const sortBy = opts.sort as 'confidence' | 'occurrences' | 'lastSeen';
        patterns.sort((a, b) => {
          switch (sortBy) {
            case 'confidence': return b.confidence - a.confidence;
            case 'occurrences': return b.occurrences - a.occurrences;
            case 'lastSeen': return b.lastSeenAt.localeCompare(a.lastSeenAt);
            default: return 0;
          }
        });

        const builtIn = patterns.filter(p => p.source === 'built-in').length;
        const learned = patterns.filter(p => p.source === 'learned').length;

        console.log(`\n${BOLD}Failure Patterns — ${ctx.config.project.name}${RESET}`);
        console.log(`${GRAY}Total: ${patterns.length} (${builtIn} built-in, ${learned} learned)${RESET}\n`);

        if (patterns.length === 0) {
          console.log(`  ${GRAY}No patterns found.${RESET}\n`);
          return;
        }

        for (const p of patterns) {
          const confColor = p.confidence > 0.7 ? GREEN : p.confidence > 0.3 ? YELLOW : RED;
          const sourceTag = p.source === 'built-in' ? `${GRAY}[built-in]${RESET}` : `${YELLOW}[learned]${RESET}`;
          console.log(`  ${BOLD}${p.category}${RESET} ${sourceTag}`);
          console.log(`    ${p.description}`);
          console.log(`    Confidence: ${confColor}${(p.confidence * 100).toFixed(0)}%${RESET} | Occurrences: ${p.occurrences}`);
          if (p.suggestedFix) {
            console.log(`    Fix: ${GREEN}${p.suggestedFix}${RESET}`);
          }
          console.log('');
        }
      } finally {
        ctx.close();
      }
    });
}
