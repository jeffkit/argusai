/**
 * @module commands/rebuild
 * `argusai rebuild` — One-step rebuild (clean + build + setup).
 */

import { Command } from 'commander';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(icon: string, msg: string): void {
  console.log(`  ${icon} ${msg}`);
}

export function registerRebuild(program: Command): void {
  program
    .command('rebuild')
    .description('一键重建测试环境（clean + build + setup）')
    .option('--no-cache', '禁用 Docker 构建缓存')
    .action(async (opts: { cache?: boolean }) => {
      const {
        loadConfig,
        buildImage,
        stopContainer,
        removeNetwork,
        startContainer,
        ensureNetwork,
        waitForHealthy,
        createMockServer,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;
      const totalStart = Date.now();

      console.log(`\n${BOLD}Rebuilding test environment...${RESET}\n`);

      let config;
      try {
        config = await loadConfig(configPath);
        log(`${GREEN}✓${RESET}`, `Project: ${config.project.name}`);
      } catch (err) {
        console.error(`  ${RED}✗${RESET} ${(err as Error).message}`);
        process.exit(1);
      }

      if (!config.service) {
        console.error(`  ${RED}✗${RESET} No service configured in e2e.yaml`);
        process.exit(1);
      }

      // Step 1: Clean
      log(`${GRAY}[1/4]${RESET}`, 'Cleaning previous environment...');
      try {
        await stopContainer(config.service.container.name);
        log(`${GREEN}✓${RESET}`, `Container "${config.service.container.name}" removed`);
      } catch {
        log(`${GRAY}-${RESET}`, 'No previous container');
      }
      const networkName = config.network?.name ?? 'e2e-network';
      try {
        await removeNetwork(networkName);
      } catch { /* ignore */ }

      // Step 2: Build
      log(`${GRAY}[2/4]${RESET}`, 'Building image...');
      try {
        for await (const event of buildImage({
          imageName: config.service.build.image,
          dockerfile: config.service.build.dockerfile,
          context: config.service.build.context,
          buildArgs: config.service.build.args,
          noCache: opts.cache === false,
        })) {
          if (event.type === 'build_end' && !event.success) {
            throw new Error(event.error ?? 'Build failed');
          }
        }
        log(`${GREEN}✓${RESET}`, `Image: ${config.service.build.image}`);
      } catch (err) {
        console.error(`  ${RED}✗${RESET} Build failed: ${(err as Error).message}`);
        process.exit(1);
      }

      // Step 3: Mock
      log(`${GRAY}[3/4]${RESET}`, 'Starting mock services...');
      if (config.mocks) {
        for (const [name, mockConfig] of Object.entries(config.mocks)) {
          if (mockConfig.routes && mockConfig.routes.length > 0) {
            try {
              const mockApp = await createMockServer(mockConfig, { name });
              await mockApp.listen({ port: mockConfig.port, host: '0.0.0.0' });
              log(`${GREEN}✓${RESET}`, `Mock "${name}" on port ${mockConfig.port}`);
            } catch (err) {
              console.error(`  ${RED}✗${RESET} Mock "${name}" failed: ${(err as Error).message}`);
            }
          }
        }
      } else {
        log(`${GRAY}-${RESET}`, 'No mocks configured');
      }

      // Step 4: Setup
      log(`${GRAY}[4/4]${RESET}`, 'Starting container...');
      try {
        await ensureNetwork(networkName);
        await startContainer({
          name: config.service.container.name,
          image: config.service.build.image,
          ports: config.service.container.ports,
          environment: config.service.container.environment,
          volumes: config.service.container.volumes,
          network: networkName,
        });
        log(`${GREEN}✓${RESET}`, `Container "${config.service.container.name}" started`);
      } catch (err) {
        console.error(`  ${RED}✗${RESET} ${(err as Error).message}`);
        process.exit(1);
      }

      if (config.service.container.healthcheck) {
        try {
          const healthy = await waitForHealthy(config.service.container.name, 120_000);
          if (!healthy) throw new Error('Timed out');
          log(`${GREEN}✓${RESET}`, 'Service is healthy');
        } catch (err) {
          console.error(`  ${RED}✗${RESET} Health check failed: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
      console.log(`\n${GREEN}${BOLD}Rebuild complete!${RESET} ${GRAY}(${elapsed}s)${RESET}\n`);
    });
}
