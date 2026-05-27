/**
 * @module assertion-plugin-registry
 * Registry for custom assertion plugins.
 *
 * External packages (e.g., Recursive agent, Claude Code agent) can register
 * their own assertion plugins to extend the assertion system without
 * modifying argusai-core.
 *
 * @example
 * ```ts
 * import { globalAssertionPluginRegistry } from 'argusai-core';
 *
 * globalAssertionPluginRegistry.register({
 *   name: 'recursive-session',
 *   assert(type, input, config) {
 *     if (type !== 'recursive-session') return [];
 *     return mySessionAssertions(input as string, config);
 *   },
 * });
 * ```
 */

import type { AssertionPlugin, AssertionResult } from './types.js';

/**
 * Registry for custom assertion plugins.
 *
 * Plugins are matched by name prefix: a plugin named `'recursive-session'`
 * will be called for assertion types that start with `'recursive-session'`.
 */
export class AssertionPluginRegistry {
  private plugins = new Map<string, AssertionPlugin>();

  /**
   * Register a custom assertion plugin.
   *
   * @param plugin - Plugin to register (must have a unique `name`)
   * @throws {Error} If a plugin with the same name is already registered
   */
  register(plugin: AssertionPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Assertion plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Get a registered plugin by name.
   */
  get(name: string): AssertionPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * List all registered plugin names.
   */
  list(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Run all registered plugins for the given assertion type.
   *
   * Each plugin's `assert()` is called; results are aggregated.
   * Plugins that return an empty array are silently skipped.
   *
   * @param type - Assertion type string
   * @param input - Primary input for the assertion
   * @param config - Plugin-specific configuration
   * @returns Combined results from all matching plugins
   */
  runAll(type: string, input: unknown, config: unknown): AssertionResult[] {
    const results: AssertionResult[] = [];
    for (const plugin of this.plugins.values()) {
      const pluginResults = plugin.assert(type, input, config);
      results.push(...pluginResults);
    }
    return results;
  }

  /**
   * Check whether any plugin handles the given assertion type.
   */
  handles(type: string): boolean {
    for (const plugin of this.plugins.values()) {
      if (type.startsWith(plugin.name)) return true;
    }
    return false;
  }
}

/** Global singleton registry — import and register your plugins at process startup. */
export const globalAssertionPluginRegistry = new AssertionPluginRegistry();
