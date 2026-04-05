/**
 * @module runners/yaml-runner
 * YAML test runner implementation.
 *
 * Implements the {@link TestRunner} interface using the YAML engine
 * to execute declarative HTTP test files.
 */

import type { TestRunner, RunConfig, TestEvent, VariableContext } from '../types.js';
import { loadYAMLTests, executeYAMLSuite } from '../yaml-engine.js';

/**
 * YAML declarative test runner.
 *
 * Loads a `.yaml` test file and executes it using the YAML engine.
 * The `target` field in {@link RunConfig} should be the path to the
 * YAML test file.
 *
 * Environment variables from `config.env` are used to determine the
 * base URL (`BASE_URL` or defaults to `http://localhost:3000`).
 */
export class YAMLRunner implements TestRunner {
  id = 'yaml';

  /**
   * Execute a YAML test suite.
   *
   * @param config - Run configuration
   * @param config.target - Path to the YAML test file
   * @param config.env - Environment variables (uses `BASE_URL`)
   * @param config.timeout - Default request timeout in milliseconds
   * @yields {TestEvent} Test progress events
   */
  async *run(config: RunConfig): AsyncGenerator<TestEvent> {
    const suite = await loadYAMLTests(config.target);

    const baseUrl = config.env['BASE_URL'] ?? 'http://localhost:3000';

    const variables: VariableContext = {
      config: config.configVars ?? {},
      runtime: {},
      env: config.env,
    };

    yield* executeYAMLSuite(suite, {
      baseUrl,
      variables,
      defaultTimeout: config.timeout,
    });
  }

  /**
   * Check if the YAML runner is available.
   *
   * Always available since it only depends on built-in modules.
   *
   * @returns `true`
   */
  async available(): Promise<boolean> {
    return true;
  }
}
