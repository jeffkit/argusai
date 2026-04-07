/**
 * @module commands/setup
 * `argusai setup` — One-command environment setup.
 *
 * Aligned with MCP `argus_setup`: uses MultiServiceOrchestrator for
 * multi-service support, PortResolver for conflict avoidance,
 * OrphanCleaner for stale resource cleanup, PreflightChecker for
 * health validation, and worktree-aware namespace derivation.
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(icon: string, msg: string): void {
  console.log(`  ${icon} ${msg}`);
}

async function commandExists(cmd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn('which', [cmd], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export function registerSetup(program: Command): void {
  program
    .command('setup')
    .description('一键搭建测试环境（支持多服务、端口自动分配、worktree 隔离）')
    .option('--skip-build', '跳过镜像构建')
    .option('--no-preflight', '跳过预检健康检查')
    .action(async (opts: { skipBuild?: boolean; preflight?: boolean }) => {
      const {
        loadConfig,
        buildImage,
        startContainer,
        ensureNetwork,
        waitForHealthy,
        createMockServer,
        isPortInUse,
        MultiServiceOrchestrator,
        PreflightChecker,
        PortResolver,
        OrphanCleaner,
        detectWorktree,
      } = await import('argusai-core');

      const configPath = program.opts().config as string | undefined;
      const cwd = process.cwd();

      console.log(`\n${BOLD}Setting up e2e environment...${RESET}\n`);

      // ── Step 1: Check dependencies ──
      log(`${GRAY}[1/7]${RESET}`, 'Checking dependencies...');
      const hasDocker = await commandExists('docker');
      const hasNode = await commandExists('node');

      if (!hasDocker) {
        console.error(`  ${RED}✗${RESET} Docker not found. Please install Docker first.`);
        process.exit(1);
      }
      log(`${GREEN}✓${RESET}`, 'Docker available');

      if (!hasNode) {
        console.error(`  ${RED}✗${RESET} Node.js not found.`);
        process.exit(1);
      }
      log(`${GREEN}✓${RESET}`, 'Node.js available');

      // ── Step 2: Load config + detect worktree ──
      log(`${GRAY}[2/7]${RESET}`, 'Loading configuration...');
      let config;
      try {
        config = await loadConfig(configPath);
        log(`${GREEN}✓${RESET}`, `Project: ${config.project.name}`);
      } catch (err) {
        console.error(`  ${RED}✗${RESET} ${(err as Error).message}`);
        process.exit(1);
      }

      const worktreeInfo = detectWorktree(cwd);
      if (worktreeInfo.isWorktree) {
        log(`${CYAN}⎇${RESET}`, `Worktree detected: branch "${worktreeInfo.branch}" → namespace suffix "${worktreeInfo.slug}"`);
      }

      // Derive worktree-aware namespace and network name
      const projectSlug = config.isolation?.namespace
        ?? config.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const namespace = worktreeInfo.isWorktree && worktreeInfo.slug
        ? `${projectSlug}-${worktreeInfo.slug}`
        : projectSlug;
      const networkName = config.network?.name && !worktreeInfo.isWorktree
        ? config.network.name
        : `argusai-${namespace}-network`;

      // ── Step 3: Normalize services (multi-service support) ──
      const orchestrator = new MultiServiceOrchestrator();
      let services = orchestrator.normalizeServices(config);
      let mocks = config.mocks ?? {};
      const hasInfrastructure = services.length > 0 || Object.keys(mocks).length > 0;

      if (services.length === 0 && Object.keys(mocks).length === 0) {
        log(`${YELLOW}○${RESET}`, 'No services or mocks configured (test-only mode)');
        console.log(`\n${GREEN}${BOLD}Ready for test-only mode.${RESET}\n`);
        return;
      }

      log(`${GREEN}✓${RESET}`, `${services.length} service(s), ${Object.keys(mocks).length} mock(s) configured`);

      // ── Step 4: Preflight check ──
      if (opts.preflight !== false && hasInfrastructure) {
        log(`${GRAY}[3/7]${RESET}`, 'Running preflight checks...');
        const preflightConfig = config.resilience?.preflight ?? { enabled: true, diskSpaceThreshold: '2GB', cleanOrphans: true };
        const checker = new PreflightChecker();
        const report = await checker.runAll(preflightConfig, config.project.name, Date.now().toString(36));

        if (report.overall === 'unhealthy') {
          console.error(`  ${RED}✗${RESET} Preflight failed: environment is unhealthy`);
          for (const check of report.checks) {
            if (check.status !== 'healthy') {
              console.error(`    ${RED}•${RESET} ${check.name}: ${check.message ?? check.status}`);
            }
          }
          process.exit(1);
        }
        log(`${GREEN}✓${RESET}`, 'Preflight passed');

        if (preflightConfig.cleanOrphans) {
          const cleaner = new OrphanCleaner(config.project.name, Date.now().toString(36));
          const orphanResult = await cleaner.detectAndCleanup();
          if (orphanResult.containersRemoved > 0 || orphanResult.networksRemoved > 0) {
            log(`${YELLOW}○${RESET}`, `Cleaned ${orphanResult.containersRemoved} orphan container(s), ${orphanResult.networksRemoved} network(s)`);
          }
        }
      } else {
        log(`${YELLOW}○${RESET}`, 'Skipping preflight');
      }

      // ── Step 5: Port conflict resolution ──
      log(`${GRAY}[4/7]${RESET}`, 'Resolving ports...');
      const portStrategy = config.resilience?.network?.portConflictStrategy ?? 'auto';
      const resolver = new PortResolver(portStrategy);
      const resolved = await resolver.resolveServicePorts(services, mocks);
      services = resolved.services;
      mocks = resolved.mocks;

      if (resolved.portMappings.some((m: { reassigned: boolean }) => m.reassigned)) {
        for (const pm of resolved.portMappings.filter((m: { reassigned: boolean }) => m.reassigned)) {
          log(`${YELLOW}○${RESET}`, `Port ${pm.original} → ${pm.resolved} (${pm.service})`);
        }
      }
      log(`${GREEN}✓${RESET}`, 'Ports resolved');

      // ── Step 6: Build images ──
      if (!opts.skipBuild) {
        log(`${GRAY}[5/7]${RESET}`, `Building ${services.length} image(s)...`);
        for (const svc of services) {
          try {
            for await (const event of buildImage({
              imageName: svc.build.image,
              dockerfile: svc.build.dockerfile,
              context: svc.build.context,
              buildArgs: svc.build.args,
            })) {
              if (event.type === 'build_end' && !event.success) {
                throw new Error(event.error ?? 'Build failed');
              }
            }
            log(`${GREEN}✓${RESET}`, `Built: ${svc.build.image}`);
          } catch (err) {
            console.error(`  ${RED}✗${RESET} Build failed for "${svc.name}": ${(err as Error).message}`);
            process.exit(1);
          }
        }
      } else {
        log(`${YELLOW}○${RESET}`, 'Skipping build (--skip-build)');
      }

      // ── Step 7: Create network + start mocks + start services ──
      log(`${GRAY}[6/7]${RESET}`, `Creating network: ${networkName}`);
      try {
        await ensureNetwork(networkName);
        log(`${GREEN}✓${RESET}`, `Network ready: ${networkName}`);
      } catch {
        log(`${YELLOW}○${RESET}`, `Network "${networkName}" may already exist`);
      }

      // Start mock services
      if (Object.keys(mocks).length > 0) {
        log(`${GRAY}[6.1/7]${RESET}`, 'Starting mock services...');
        for (const [name, mockConfig] of Object.entries(mocks)) {
          const mc = mockConfig as { port: number; routes?: unknown[]; containerPort?: number };
          try {
            const portInUse = await isPortInUse(mc.port);
            if (portInUse) {
              console.error(`  ${RED}✗${RESET} Port ${mc.port} already in use for mock "${name}"`);
              continue;
            }
            const mockServer = await createMockServer(mc as Parameters<typeof createMockServer>[0], { name });
            await mockServer.listen({ port: mc.port, host: '0.0.0.0' });
            log(`${GREEN}✓${RESET}`, `Mock "${name}" on port ${mc.port}`);
          } catch (err) {
            console.error(`  ${RED}✗${RESET} Mock "${name}" failed: ${(err as Error).message}`);
          }
        }
      }

      // Start service containers in dependency order
      log(`${GRAY}[7/7]${RESET}`, 'Starting service containers...');
      const orderedServices = orchestrator.topologicalSort(services);

      for (const svc of orderedServices) {
        try {
          const hcPort = svc.container.healthcheck?.port ?? extractContainerPort(svc.container.ports);
          const portSuffix = hcPort ? `:${hcPort}` : '';

          await startContainer({
            name: svc.container.name,
            image: svc.build.image,
            ports: svc.container.ports,
            environment: svc.container.environment,
            volumes: svc.container.volumes,
            network: networkName,
            healthcheck: svc.container.healthcheck
              ? {
                  cmd: `wget -qO- http://localhost${portSuffix}${svc.container.healthcheck.path} || exit 1`,
                  interval: svc.container.healthcheck.interval ?? '10s',
                  timeout: svc.container.healthcheck.timeout ?? '5s',
                  retries: svc.container.healthcheck.retries ?? 10,
                  startPeriod: svc.container.healthcheck.startPeriod ?? '30s',
                }
              : undefined,
          });
          log(`${GREEN}✓${RESET}`, `Container "${svc.container.name}" started`);

          if (svc.container.healthcheck) {
            const healthy = await waitForHealthy(svc.container.name, 120_000);
            if (healthy) {
              log(`${GREEN}✓${RESET}`, `"${svc.name}" is healthy`);
            } else {
              console.error(`  ${RED}✗${RESET} "${svc.name}" health check timed out`);
              process.exit(1);
            }
          }
        } catch (err) {
          console.error(`  ${RED}✗${RESET} Failed to start "${svc.name}": ${(err as Error).message}`);
          process.exit(1);
        }
      }

      console.log(`\n${GREEN}${BOLD}Environment ready!${RESET}`);
      console.log(`  Network: ${networkName}`);
      if (worktreeInfo.isWorktree) {
        console.log(`  Worktree: ${worktreeInfo.branch}`);
      }
      console.log();
    });
}

function extractContainerPort(ports: string[]): number | undefined {
  if (ports.length === 0) return undefined;
  const parts = ports[0]!.split(':');
  return parts.length >= 2 ? parseInt(parts[1]!, 10) : parseInt(parts[0]!, 10);
}
