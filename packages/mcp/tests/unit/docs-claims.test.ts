/**
 * Docs-claims guard — keeps the README MCP tool inventory in sync with src/server.ts.
 *
 * The tool list is the contract downstream consumers (marketplace, .mcp.json)
 * integrate against. These tests fail when tools are added/removed in code
 * without updating the root README, so drift cannot spread silently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverSource = readFileSync(
  fileURLToPath(new URL('../../src/server.ts', import.meta.url)),
  'utf8',
);
const readme = readFileSync(
  fileURLToPath(new URL('../../../../README.md', import.meta.url)),
  'utf8',
);

function registeredTools(): string[] {
  return [...serverSource.matchAll(/server\.tool\(\s*'([^']+)'/g)].map((m) => m[1]);
}

function readmeClaimedToolCount(): number {
  const claims = [...readme.matchAll(/（(\d+) 个工具）/g)].map((m) => Number(m[1]));
  expect(claims, 'README should state the tool count exactly once').toHaveLength(1);
  return claims[0];
}

function readmeToolSection(): string {
  const start = readme.indexOf('### MCP 工具列表');
  expect(start, 'README should contain an "### MCP 工具列表" section').toBeGreaterThanOrEqual(0);
  const nextHeading = readme.indexOf('\n### ', start + 1);
  return readme.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

function readmeToolTableNames(): string[] {
  return [...readmeToolSection().matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
}

describe('docs claims: MCP tool inventory', () => {
  it('registers exactly as many tools as the README claims', () => {
    const claimed = readmeClaimedToolCount();

    expect(
      registeredTools(),
      'server.tool() registrations in src/server.ts should match the README tool count',
    ).toHaveLength(claimed);
    expect(
      readmeToolTableNames(),
      'rows in the README "MCP 工具列表" table should match the README tool count',
    ).toHaveLength(claimed);
  });

  it('keeps tool names consistent in both directions (no stale, no missing)', () => {
    const registered = new Set(registeredTools());
    const documented = new Set(readmeToolTableNames());

    const missingFromReadme = [...registered].filter((name) => !documented.has(name));
    const staleInReadme = [...documented].filter((name) => !registered.has(name));

    expect(missingFromReadme, 'registered in server.ts but absent from README table').toEqual([]);
    expect(staleInReadme, 'listed in README table but not registered in server.ts').toEqual([]);
  });

  it('explains the count: import lines + known two-handler module (run.ts) == tool count', () => {
    const importLines = serverSource.match(/^import \{[^}]*\} from '\.\/tools\/[^']+';/gm) ?? [];
    const handlerNames = importLines.flatMap((line) => line.match(/handle[A-Za-z]+/g) ?? []);
    const multiHandlerModules = importLines.filter(
      (line) => (line.match(/handle[A-Za-z]+/g) ?? []).length > 1,
    );

    expect(handlerNames, 'one handler per registered tool').toHaveLength(registeredTools().length);
    // tools/run.ts is the only module exporting two handlers (handleRun + handleRunSuite),
    // so the number of import lines is exactly one less than the tool count.
    expect(multiHandlerModules).toHaveLength(1);
    expect(multiHandlerModules[0]).toContain("from './tools/run.js'");
    expect(multiHandlerModules[0]).toContain('handleRun');
    expect(multiHandlerModules[0]).toContain('handleRunSuite');
    expect(registeredTools().length - importLines.length).toBe(multiHandlerModules.length);
  });
});
