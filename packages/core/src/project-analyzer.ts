/**
 * @module project-analyzer
 * Static project scanner that infers an e2e.yaml draft from a repo.
 *
 * The analyzer is intentionally read-only and conservative: it reports what
 * it found and produces a best-effort config, but never assumes anything
 * it cannot verify. Callers decide whether to write the draft.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import yaml from 'js-yaml';
import type { E2EConfig } from './types.js';

// =====================================================================
// Public API
// =====================================================================

export interface AnalyzeOptions {
  /** Project root directory to scan. */
  projectPath: string;
  /** Optional override for the project name. Defaults to directory basename. */
  projectName?: string;
}

export interface AnalysisReport {
  /** "node" / "python" / "go" / "rust" / "java" / "unknown". */
  projectType: 'node' | 'python' | 'go' | 'rust' | 'java' | 'unknown';
  /** Detected framework (e.g. "next", "express", "fastapi"). */
  framework?: string;
  /** Detected port numbers (from EXPOSE, package.json scripts, defaults). */
  detectedPorts: number[];
  /** Detected health-check paths (e.g. "/health", "/healthz"). */
  detectedHealthPaths: string[];
  /** Paths to OpenAPI / Swagger specs. */
  detectedOpenAPISpecs: string[];
  /** Paths to existing test files (.test.ts / test_*.py / *_test.go / etc.). */
  detectedTestFiles: string[];
  /** True when a Dockerfile exists at the project root. */
  hasDockerfile: boolean;
  /** Suggested E2EConfig draft. */
  suggestedConfig: E2EConfig;
  /** Non-fatal warnings / notes from the analysis. */
  warnings: string[];
}

// =====================================================================
// Implementation
// =====================================================================

const DEFAULT_HEALTH_PATHS = ['/health', '/healthz', '/api/health'];
const DEFAULT_PORTS_BY_FRAMEWORK: Record<string, number> = {
  next: 3000,
  nuxt: 3000,
  express: 3000,
  fastify: 3000,
  koa: 3000,
  vite: 5173,
  fastapi: 8000,
  flask: 5000,
  django: 8000,
  gin: 8080,
  echo: 8080,
  actix: 8080,
  rocket: 8000,
  spring: 8080,
};

export async function analyzeProject(opts: AnalyzeOptions): Promise<AnalysisReport> {
  const root = resolve(opts.projectPath);
  const projectName = opts.projectName ?? basename(root);

  const warnings: string[] = [];
  let projectType: AnalysisReport['projectType'] = 'unknown';
  let framework: string | undefined;
  let detectedPorts: number[] = [];
  let detectedHealthPaths: string[] = [];
  const detectedOpenAPISpecs: string[] = [];
  let detectedTestFiles: string[] = [];
  const hasDockerfile = existsSafe(join(root, 'Dockerfile'));

  // ---- Language detection ----
  if (existsSafe(join(root, 'package.json'))) {
    projectType = 'node';
    const node = detectNode(root);
    framework = node.framework;
    detectedPorts.push(...node.ports);
    detectedHealthPaths.push(...node.healthPaths);
    detectedTestFiles.push(...node.testFiles);
    if (node.startScript) {
      warnings.push(`Detected start script: "${node.startScript}" — include it in container.command if your service doesn't auto-start.`);
    }
  } else if (existsSafe(join(root, 'pyproject.toml')) || existsSafe(join(root, 'requirements.txt')) || existsSafe(join(root, 'setup.py'))) {
    projectType = 'python';
    const py = detectPython(root);
    framework = py.framework;
    detectedPorts.push(...py.ports);
    detectedHealthPaths.push(...py.healthPaths);
    detectedTestFiles.push(...py.testFiles);
  } else if (existsSafe(join(root, 'go.mod'))) {
    projectType = 'go';
    const g = detectGo(root);
    framework = g.framework;
    detectedPorts.push(...g.ports);
    detectedHealthPaths.push(...g.healthPaths);
    detectedTestFiles.push(...g.testFiles);
  } else if (existsSafe(join(root, 'Cargo.toml'))) {
    projectType = 'rust';
    const r = detectRust(root);
    framework = r.framework;
    detectedPorts.push(...r.ports);
    detectedHealthPaths.push(...r.healthPaths);
    detectedTestFiles.push(...r.testFiles);
  } else if (existsSafe(join(root, 'pom.xml')) || existsSafe(join(root, 'build.gradle')) || existsSafe(join(root, 'build.gradle.kts'))) {
    projectType = 'java';
    const j = detectJava(root);
    framework = j.framework;
    detectedPorts.push(...j.ports);
    detectedHealthPaths.push(...j.healthPaths);
    detectedTestFiles.push(...j.testFiles);
  } else {
    warnings.push('No recognized language manifest (package.json / pyproject.toml / go.mod / Cargo.toml / pom.xml) found.');
  }

  // ---- OpenAPI / Swagger ----
  for (const candidate of ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json']) {
    const p = join(root, candidate);
    if (existsSafe(p)) detectedOpenAPISpecs.push(relative(root, p));
  }
  // Look one level under specs/ and api/
  for (const dir of ['specs', 'spec', 'api', 'docs', 'openapi']) {
    const fullDir = join(root, dir);
    if (existsSafe(fullDir) && statSafe(fullDir)?.isDirectory()) {
      for (const f of readdirSafe(fullDir)) {
        if (/\.(ya?ml|json)$/i.test(f) && /(openapi|swagger)/i.test(f)) {
          detectedOpenAPISpecs.push(relative(root, join(fullDir, f)));
        }
      }
    }
  }

  // ---- Dockerfile EXPOSE ----
  if (hasDockerfile) {
    const dockerfile = readFileSafe(join(root, 'Dockerfile'), 'utf-8') ?? '';
    const exposeMatches = dockerfile.matchAll(/^\s*EXPOSE\s+(.+)$/gim);
    for (const m of exposeMatches) {
      for (const port of m[1]!.split(/\s+/)) {
        const n = Number(port.split('/')[0]);
        if (Number.isFinite(n) && n > 0) detectedPorts.push(n);
      }
    }
  }

  // ---- Fallback ports from framework ----
  if (detectedPorts.length === 0 && framework && DEFAULT_PORTS_BY_FRAMEWORK[framework]) {
    detectedPorts.push(DEFAULT_PORTS_BY_FRAMEWORK[framework]!);
    warnings.push(`No EXPOSE directive or script port detected; assuming framework default ${detectedPorts[0]} for "${framework}".`);
  }

  // Dedupe + sort ports
  detectedPorts = [...new Set(detectedPorts)].sort((a, b) => a - b);

  // ---- Health path fallback ----
  if (detectedHealthPaths.length === 0) {
    detectedHealthPaths = [...DEFAULT_HEALTH_PATHS];
  } else {
    detectedHealthPaths = [...new Set(detectedHealthPaths)];
  }

  // ---- Build suggested config ----
  const port = detectedPorts[0] ?? 3000;
  const healthPath = detectedHealthPaths[0] ?? '/health';
  const imageName = `${projectName}:e2e`;

  const suggestedConfig: E2EConfig = {
    version: '1',
    project: {
      name: projectName,
      description: `Auto-generated by argus_analyze on ${new Date().toISOString()}`,
    },
  };

  if (hasDockerfile || projectType !== 'unknown') {
    suggestedConfig.service = {
      build: {
        dockerfile: hasDockerfile ? './Dockerfile' : './Dockerfile',
        context: '.',
        image: imageName,
      },
      container: {
        name: `${projectName}-e2e`,
        ports: [`${port}:${port}`],
        healthcheck: {
          path: healthPath,
          interval: '10s',
          timeout: '5s',
          retries: 10,
          startPeriod: '30s',
        },
      },
      vars: {
        base_url: `http://localhost:${port}`,
      },
    };
  } else {
    warnings.push('No Dockerfile and no recognized language — service block omitted (test-only mode).');
  }

  if (detectedOpenAPISpecs.length > 0) {
    suggestedConfig.mocks = {
      'auto-mock': {
        port: 9080,
        openapi: `./${detectedOpenAPISpecs[0]!}`,
        mode: 'auto',
      },
    };
  }

  if (detectedTestFiles.length > 0) {
    const suite = detectedTestFiles.find((f) => /\.(yaml|yml)$/i.test(f)) ?? detectedTestFiles[0]!;
    const isYaml = /\.(yaml|yml)$/i.test(suite);
    suggestedConfig.tests = {
      suites: [
        {
          name: 'Generated',
          id: 'generated',
          file: relative(root, suite) || suite,
          runner: isYaml ? 'yaml' : undefined,
        },
      ],
    };
    warnings.push(`Detected test file "${suite}" — review the generated suite, it may need runner-specific tweaks.`);
  }

  return {
    projectType,
    framework,
    detectedPorts,
    detectedHealthPaths,
    detectedOpenAPISpecs,
    detectedTestFiles,
    hasDockerfile,
    suggestedConfig,
    warnings,
  };
}

// =====================================================================
// Language detectors
// =====================================================================

interface NodeDetect {
  framework?: string;
  ports: number[];
  healthPaths: string[];
  testFiles: string[];
  startScript?: string;
}

function detectNode(root: string): NodeDetect {
  const out: NodeDetect = { ports: [], healthPaths: [], testFiles: [] };
  const pkgRaw = readFileSafe(join(root, 'package.json'), 'utf-8');
  if (!pkgRaw) return out;
  let pkg: any;
  try { pkg = JSON.parse(pkgRaw); } catch { return out; }

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const fw of ['next', 'nuxt', 'express', 'fastify', 'koa', 'vite', 'remix']) {
    if (deps[fw]) { out.framework = fw; break; }
  }

  // Scripts — look for `PORT=` or default ports in start/dev.
  const startScript = pkg.scripts?.start ?? pkg.scripts?.dev;
  if (typeof startScript === 'string') {
    out.startScript = startScript;
    const portMatch = startScript.match(/PORT\s*=\s*(\d+)/);
    if (portMatch) out.ports.push(Number(portMatch[1]));
  }

  // Test files
  out.testFiles = listFilesRecursive(root, /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/, { maxDepth: 4 });

  return out;
}

interface PythonDetect {
  framework?: string;
  ports: number[];
  healthPaths: string[];
  testFiles: string[];
}

function detectPython(root: string): PythonDetect {
  const out: PythonDetect = { ports: [], healthPaths: [], testFiles: [] };
  const pyproject = readFileSafe(join(root, 'pyproject.toml'), 'utf-8') ?? '';
  const reqTxt = readFileSafe(join(root, 'requirements.txt'), 'utf-8') ?? '';
  const combined = `${pyproject}\n${reqTxt}`.toLowerCase();

  for (const [lib, fw] of [['fastapi', 'fastapi'], ['flask', 'flask'], ['django', 'django']] as const) {
    if (combined.includes(lib)) { out.framework = fw; break; }
  }

  out.testFiles = listFilesRecursive(root, /^test_.*\.py$|.*_test\.py$|.*\.test\.py$/, { maxDepth: 4 });
  return out;
}

interface GoDetect {
  framework?: string;
  ports: number[];
  healthPaths: string[];
  testFiles: string[];
}

function detectGo(root: string): GoDetect {
  const out: GoDetect = { ports: [], healthPaths: [], testFiles: [] };
  const goMod = readFileSafe(join(root, 'go.mod'), 'utf-8') ?? '';
  const lower = goMod.toLowerCase();
  for (const [lib, fw] of [['gin-gonic/gin', 'gin'], ['labstack/echo', 'echo'], ['gofiber/fiber', 'fiber']] as const) {
    if (lower.includes(lib)) { out.framework = fw; break; }
  }
  out.testFiles = listFilesRecursive(root, /_test\.go$/, { maxDepth: 4 });
  return out;
}

interface RustDetect {
  framework?: string;
  ports: number[];
  healthPaths: string[];
  testFiles: string[];
}

function detectRust(root: string): RustDetect {
  const out: RustDetect = { ports: [], healthPaths: [], testFiles: [] };
  const cargo = readFileSafe(join(root, 'Cargo.toml'), 'utf-8') ?? '';
  const lower = cargo.toLowerCase();
  for (const [lib, fw] of [['actix-web', 'actix'], ['rocket', 'rocket'], ['axum', 'axum']] as const) {
    if (lower.includes(lib)) { out.framework = fw; break; }
  }
  out.testFiles = listFilesRecursive(root, /_test\.rs$|^tests\/.*\.rs$/, { maxDepth: 4 });
  return out;
}

interface JavaDetect {
  framework?: string;
  ports: number[];
  healthPaths: string[];
  testFiles: string[];
}

function detectJava(root: string): JavaDetect {
  const out: JavaDetect = { ports: [], healthPaths: [], testFiles: [] };
  const pom = readFileSafe(join(root, 'pom.xml'), 'utf-8') ?? '';
  const gradle = readFileSafe(join(root, 'build.gradle'), 'utf-8') ?? readFileSafe(join(root, 'build.gradle.kts'), 'utf-8') ?? '';
  const combined = `${pom}\n${gradle}`.toLowerCase();
  if (combined.includes('spring-boot')) out.framework = 'spring';
  out.testFiles = listFilesRecursive(root, /Test\.java$|Tests\.java$|Spec\.java$/, { maxDepth: 6 });
  return out;
}

// =====================================================================
// FS helpers — all swallow errors so a single bad path doesn't tank analysis
// =====================================================================

function existsSafe(p: string): boolean {
  try { return existsSync(p); } catch { return false; }
}

function readFileSafe(p: string, enc: 'utf-8'): string | null {
  try { return readFileSync(p, enc); } catch { return null; }
}

function statSafe(p: string) {
  try { return statSync(p); } catch { return undefined; }
}

function readdirSafe(p: string): string[] {
  try { return readdirSync(p); } catch { return []; }
}

function listFilesRecursive(
  root: string,
  pattern: RegExp,
  opts: { maxDepth?: number } = {},
): string[] {
  const maxDepth = opts.maxDepth ?? 4;
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'venv', '.venv', '.next']);

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) {
        walk(full, depth + 1);
      } else if (s.isFile() && pattern.test(entry)) {
        out.push(relative(root, full));
      }
    }
  }

  walk(root, 0);
  return out;
}

/**
 * Serialize an E2EConfig to a YAML string. Exposed so MCP / CLI handlers can
 * materialize an analyzed config without importing js-yaml directly.
 *
 * @param config - Validated E2EConfig
 * @returns YAML string suitable for writing to disk
 */
export function serializeConfig(config: E2EConfig): string {
  return yaml.dump(config, { lineWidth: 120, noRefs: true });
}