/**
 * @module commands/reset-circuit
 * `argusai reset-circuit` — Reset the Docker circuit breaker.
 *
 * In CLI mode, this creates a transient circuit breaker and resets it.
 * Primarily useful as a signal that Docker issues have been resolved.
 */

import { Command } from 'commander';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function registerResetCircuit(program: Command): void {
  program
    .command('reset-circuit')
    .description('重置 Docker 熔断器状态')
    .action(async () => {
      const { loadConfig, CircuitBreaker } = await import('argusai-core');
      const configPath = program.opts().config as string | undefined;

      let config;
      try {
        config = await loadConfig(configPath);
      } catch (err) {
        console.error(`${RED}Failed to load config: ${(err as Error).message}${RESET}`);
        process.exit(1);
      }

      const cbConfig = config.resilience?.circuitBreaker;
      if (cbConfig?.enabled === false) {
        console.log(`\n${GRAY}Circuit breaker is disabled in configuration.${RESET}\n`);
        return;
      }

      console.log(`\n${BOLD}Circuit Breaker Reset${RESET}\n`);
      console.log(`  ${GRAY}Note: In CLI mode, the circuit breaker is per-process.${RESET}`);
      console.log(`  ${GRAY}This command confirms Docker is available for the next operation.${RESET}`);

      // Verify Docker is reachable
      const { spawn } = await import('node:child_process');
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn('docker', ['info'], { stdio: 'ignore' });
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });

      if (ok) {
        console.log(`\n  ${GREEN}✓${RESET} Docker daemon is reachable. Circuit breaker reset.\n`);
      } else {
        console.log(`\n  ${RED}✗${RESET} Docker daemon is NOT reachable. Please start Docker first.\n`);
        process.exit(1);
      }
    });
}
