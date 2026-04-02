/**
 * @module commands/mock-generate
 * `argusai mock-generate` — Generate mock config from OpenAPI spec.
 */

import { Command } from 'commander';
import path from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerMockGenerate(program: Command): void {
  program
    .command('mock-generate')
    .description('从 OpenAPI spec 生成 Mock 配置')
    .requiredOption('--spec <path>', 'OpenAPI spec 文件路径')
    .option('--name <name>', 'Mock 服务名称')
    .option('--port <port>', 'Mock 服务端口', '9090')
    .option('--mode <mode>', 'Mock 模式 (auto|record|replay|smart)')
    .option('--validate', '启用请求验证')
    .option('--target <url>', '真实 API 地址（record 模式需要）')
    .action(async (opts: { spec: string; name?: string; port: string; mode?: string; validate?: boolean; target?: string }) => {
      const { loadAndDereferenceSpec } = await import('argusai-core');

      const absoluteSpecPath = path.isAbsolute(opts.spec) ? opts.spec : path.resolve(opts.spec);

      let spec;
      try {
        spec = await loadAndDereferenceSpec(absoluteSpecPath);
      } catch (err) {
        console.error(`${RED}Failed to load OpenAPI spec: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      const derivedName = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'api-mock';
      const serviceName = opts.name ?? derivedName;
      const port = parseInt(opts.port, 10) || 9090;

      const methods: Record<string, number> = {};
      for (const route of spec.routes) {
        methods[route.method] = (methods[route.method] ?? 0) + 1;
      }

      const yamlLines = [
        'mocks:',
        `  ${serviceName}:`,
        `    port: ${port}`,
        `    openapi: ${opts.spec}`,
      ];
      if (opts.mode && opts.mode !== 'auto') yamlLines.push(`    mode: ${opts.mode}`);
      if (opts.validate) yamlLines.push(`    validate: true`);
      if (opts.target) yamlLines.push(`    target: ${opts.target}`);

      console.log(`\n${BOLD}Generated Mock Configuration${RESET}\n`);
      console.log(`  Spec:      ${spec.title} (OpenAPI ${spec.openApiVersion})`);
      console.log(`  Endpoints: ${spec.routes.length}`);
      console.log(`  Methods:   ${Object.entries(methods).map(([m, c]) => `${m}:${c}`).join(' ')}`);
      console.log(`\n${GRAY}--- YAML snippet (add to e2e.yaml) ---${RESET}\n`);
      console.log(yamlLines.join('\n'));
      console.log('');
    });
}
