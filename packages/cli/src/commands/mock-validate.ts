/**
 * @module commands/mock-validate
 * `argusai mock-validate` — Validate mock coverage against OpenAPI spec.
 */

import { Command } from 'commander';
import path from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerMockValidate(program: Command): void {
  program
    .command('mock-validate')
    .description('验证 Mock 配置对 OpenAPI spec 的覆盖度')
    .option('--mock <name>', 'Mock 服务名称（默认验证所有带 openapi 字段的 Mock）')
    .option('--spec <path>', '覆盖 OpenAPI spec 路径')
    .action(async (opts: { mock?: string; spec?: string }) => {
      const { loadConfig, loadAndDereferenceSpec } = await import('argusai-core');
      const configPath = program.opts().config as string | undefined;
      const projectPath = configPath ? path.dirname(path.resolve(configPath)) : process.cwd();

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      if (!config.mocks) {
        console.error(`${RED}No mocks configured in e2e.yaml.${RESET}`);
        process.exit(1);
      }

      let targetMock: string | undefined;
      let mockConfig: any;

      if (opts.mock) {
        mockConfig = config.mocks[opts.mock];
        if (!mockConfig) {
          console.error(`${RED}Mock "${opts.mock}" not found in e2e.yaml.${RESET}`);
          process.exit(1);
        }
        targetMock = opts.mock;
      } else {
        for (const [name, mc] of Object.entries(config.mocks)) {
          if ((mc as any).openapi || opts.spec) {
            targetMock = name;
            mockConfig = mc;
            break;
          }
        }
        if (!targetMock) {
          console.error(`${RED}No mock with openapi field found.${RESET}`);
          process.exit(1);
        }
      }

      const specPathRaw = opts.spec ?? mockConfig.openapi;
      if (!specPathRaw) {
        console.error(`${RED}No OpenAPI spec path available.${RESET}`);
        process.exit(1);
      }

      const absoluteSpecPath = path.isAbsolute(specPathRaw) ? specPathRaw : path.resolve(projectPath, specPathRaw);

      let spec;
      try {
        spec = await loadAndDereferenceSpec(absoluteSpecPath);
      } catch (err) {
        console.error(`${RED}Failed to load spec: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      const specEndpoints = new Set<string>();
      for (const route of spec.routes) specEndpoints.add(`${route.method}:${route.openApiPath}`);

      const mockEndpoints = new Set<string>();
      if (mockConfig.openapi) {
        for (const route of spec.routes) mockEndpoints.add(`${route.method}:${route.openApiPath}`);
      }
      for (const route of [...(mockConfig.overrides ?? []), ...(mockConfig.routes ?? [])]) {
        mockEndpoints.add(`${route.method.toUpperCase()}:${route.path}`);
      }

      const covered: string[] = [];
      const missing: string[] = [];
      for (const ep of specEndpoints) {
        if (mockEndpoints.has(ep)) covered.push(ep);
        else missing.push(ep);
      }

      const pct = specEndpoints.size > 0 ? Math.round((covered.length / specEndpoints.size) * 10000) / 100 : 100;
      const pctColor = pct === 100 ? GREEN : pct >= 80 ? YELLOW : RED;

      console.log(`\n${BOLD}Mock Coverage — ${targetMock}${RESET}\n`);
      console.log(`  Spec endpoints: ${specEndpoints.size}`);
      console.log(`  Covered:        ${GREEN}${covered.length}${RESET}`);
      console.log(`  Missing:        ${missing.length > 0 ? RED : GRAY}${missing.length}${RESET}`);
      console.log(`  Coverage:       ${pctColor}${pct}%${RESET}`);

      if (missing.length > 0) {
        console.log(`\n  ${BOLD}Missing endpoints:${RESET}`);
        for (const ep of missing) {
          const [method, p] = ep.split(':');
          console.log(`    ${RED}✗${RESET} ${method} ${p}`);
        }
      }

      console.log('');
    });
}
