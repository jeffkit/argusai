/**
 * @module commands/resources
 * `argusai resources` — Show all ArgusAI-managed Docker resources.
 */

import { Command } from 'commander';
import { spawn } from 'node:child_process';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function dockerExecCmd(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`docker exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

interface ProjectGroup {
  containers: Array<{ id: string; name: string; image: string; status: string; state: string }>;
  networks: Array<{ id: string; name: string; driver: string }>;
}

export function registerResources(program: Command): void {
  program
    .command('resources')
    .description('查看所有 ArgusAI 管理的 Docker 资源')
    .action(async () => {
      const byProject = new Map<string, ProjectGroup>();

      const ensure = (project: string): ProjectGroup => {
        if (!byProject.has(project)) {
          byProject.set(project, { containers: [], networks: [] });
        }
        return byProject.get(project)!;
      };

      // Query containers
      try {
        const raw = await dockerExecCmd([
          'ps', '-a',
          '--filter', 'label=argusai.managed=true',
          '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Label "argusai.project"}}',
        ]);
        if (raw) {
          for (const line of raw.split('\n')) {
            const [id, name, image, status, state, project] = line.split('\t');
            if (!project) continue;
            ensure(project).containers.push({
              id: id!.slice(0, 12), name: name ?? '', image: image ?? '',
              status: status ?? '', state: state ?? '',
            });
          }
        }
      } catch { /* Docker unavailable */ }

      // Query networks
      try {
        const raw = await dockerExecCmd([
          'network', 'ls',
          '--filter', 'label=argusai.managed=true',
          '--format', '{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Label "argusai.project"}}',
        ]);
        if (raw) {
          for (const line of raw.split('\n')) {
            const [id, name, driver, project] = line.split('\t');
            const effectiveProject = project || (name?.match(/^argusai-(.+)-network$/) ?? [])[1] || 'unknown';
            ensure(effectiveProject).networks.push({
              id: id!.slice(0, 12), name: name ?? '', driver: driver ?? '',
            });
          }
        }
      } catch { /* Docker unavailable */ }

      const projects = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b));
      const totalContainers = projects.reduce((s, [, p]) => s + p.containers.length, 0);
      const totalNetworks = projects.reduce((s, [, p]) => s + p.networks.length, 0);

      console.log(`\n${BOLD}ArgusAI Managed Resources${RESET}`);
      console.log(`${GRAY}${totalContainers} containers, ${totalNetworks} networks across ${projects.length} projects${RESET}\n`);

      if (projects.length === 0) {
        console.log(`  ${GRAY}No ArgusAI resources found.${RESET}\n`);
        return;
      }

      for (const [projectName, group] of projects) {
        console.log(`  ${BOLD}${projectName}${RESET}`);

        if (group.containers.length > 0) {
          for (const c of group.containers) {
            const stateColor = c.state === 'running' ? GREEN : RED;
            console.log(`    ${stateColor}●${RESET} ${c.name} (${c.image}) — ${c.status}`);
          }
        }

        if (group.networks.length > 0) {
          for (const n of group.networks) {
            console.log(`    ${GRAY}⊡${RESET} Network: ${n.name} (${n.driver})`);
          }
        }

        console.log('');
      }
    });
}
