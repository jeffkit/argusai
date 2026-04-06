/**
 * Standalone test script to verify YAML browser DSL works end-to-end.
 * Run from: platform/argusai/packages/core/
 * Usage: node test-browser-yaml.mjs <yaml-file> <base-url>
 */

import { loadYAMLTests, executeYAMLSuite } from './dist/yaml-engine.js';

const yamlFile = process.argv[2] || '/Users/kongjie/projects/agent-studio/agentstudio/tests/e2e/browser-yaml/settings.yaml';
const baseUrl = process.argv[3] || 'http://localhost:14936';

console.log(`\n🧪 Running YAML browser test: ${yamlFile}`);
console.log(`   Base URL: ${baseUrl}\n`);

try {
  const suite = await loadYAMLTests(yamlFile);
  console.log(`📋 Suite: ${suite.name} (${suite.cases.length} cases)\n`);

  const variables = { config: {}, runtime: {}, env: { BASE_URL: baseUrl } };

  let passed = 0, failed = 0;

  for await (const event of executeYAMLSuite(suite, {
    baseUrl,
    variables,
    defaultTimeout: 30_000,
    browserHeadless: true,
  })) {
    switch (event.type) {
      case 'suite_start':
        console.log(`━━━ Suite: ${event.suite} ━━━`);
        break;
      case 'case_start':
        process.stdout.write(`  ▶ ${event.name} ... `);
        break;
      case 'case_pass':
        passed++;
        console.log(`✅ (${event.duration}ms)`);
        break;
      case 'case_fail':
        failed++;
        console.log(`❌`);
        console.log(`    Error: ${event.error}`);
        break;
      case 'case_skip':
        console.log(`⏭ Skipped: ${event.reason}`);
        break;
      case 'log':
        console.log(`  [${event.level}] ${event.message}`);
        break;
      case 'suite_end':
        console.log(`\n━━━ Results: ${event.passed} passed, ${event.failed} failed (${event.duration}ms) ━━━\n`);
        break;
    }
  }

  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error('Fatal error:', err.message);
  process.exit(2);
}
