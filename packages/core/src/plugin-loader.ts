/**
 * @module plugin-loader
 * Load ArgusAI plugin modules declared in `e2e.yaml plugins[]`.
 *
 * Each specifier in the `plugins` array is resolved in order:
 * 1. Absolute path  → imported as-is
 * 2. Relative path  → resolved from `configDir`, then imported
 * 3. Otherwise      → treated as an npm package name and imported directly
 *
 * A valid plugin module must export a `PluginModule`-compatible object as its
 * default export or as a named export called `plugin`.
 *
 * After loading:
 * - `plugin.assertionPlugins` are registered in `globalAssertionPluginRegistry`
 * - `plugin.setup()` is awaited (if defined)
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginModule } from './types.js';
import { globalAssertionPluginRegistry } from './assertion-plugin-registry.js';

/** Loaded plugin handle returned by `loadPlugins` for optional teardown. */
export interface LoadedPlugin {
  name: string;
  teardown?: () => Promise<void> | void;
}

/**
 * Resolve a plugin specifier to an importable URL/path string.
 *
 * @param specifier - As written in e2e.yaml (relative, absolute, or npm package)
 * @param configDir - Absolute path to the directory containing e2e.yaml
 */
function resolveSpecifier(specifier: string, configDir: string): string {
  if (path.isAbsolute(specifier)) {
    return pathToFileURL(specifier).href;
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return pathToFileURL(path.resolve(configDir, specifier)).href;
  }
  return specifier;
}

/**
 * Extract a `PluginModule` from a dynamically imported module.
 *
 * Accepts:
 * - `export default plugin` (ESM default)
 * - `export const plugin = ...` (named `plugin` export)
 * - `module.exports = plugin` (CJS — lands in `mod.default` after `import()`)
 */
function extractPlugin(mod: Record<string, unknown>, specifier: string): PluginModule {
  const candidate = mod['default'] ?? mod['plugin'];
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(
      `Plugin "${specifier}" must export a PluginModule as \`default\` or named \`plugin\``,
    );
  }
  const p = candidate as PluginModule;
  if (typeof p.name !== 'string' || !p.name) {
    throw new Error(`Plugin "${specifier}" must have a non-empty \`name\` field`);
  }
  return p;
}

/**
 * Load all plugin modules listed in the `plugins` array from `e2e.yaml`.
 *
 * Call this after `loadConfig()` and before executing any test suites.
 * The returned handles can be used for optional teardown after all suites finish.
 *
 * @param plugins  - Plugin specifiers from `config.plugins` (may be undefined / empty)
 * @param configDir - Absolute path to the directory containing e2e.yaml
 * @returns Array of loaded plugin handles (in load order)
 */
export async function loadPlugins(
  plugins: string[] | undefined,
  configDir: string,
): Promise<LoadedPlugin[]> {
  if (!plugins || plugins.length === 0) return [];

  const loaded: LoadedPlugin[] = [];

  for (const specifier of plugins) {
    const resolved = resolveSpecifier(specifier, configDir);

    let mod: Record<string, unknown>;
    try {
      mod = await import(resolved) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Failed to load plugin "${specifier}": ${(err as Error).message}`,
      );
    }

    const plugin = extractPlugin(mod, specifier);

    // Register assertion plugins
    if (plugin.assertionPlugins) {
      for (const ap of plugin.assertionPlugins) {
        try {
          globalAssertionPluginRegistry.register(ap);
        } catch (err) {
          throw new Error(
            `Plugin "${plugin.name}" failed to register assertion plugin "${ap.name}": ${(err as Error).message}`,
          );
        }
      }
    }

    // Run setup hook
    if (plugin.setup) {
      await plugin.setup();
    }

    loaded.push({ name: plugin.name, teardown: plugin.teardown });
  }

  return loaded;
}

/**
 * Call teardown on all loaded plugins (in reverse load order).
 * Errors are logged but do not throw — teardown is best-effort.
 *
 * @param plugins - Handles returned by `loadPlugins`
 */
export async function teardownPlugins(plugins: LoadedPlugin[]): Promise<void> {
  for (const p of [...plugins].reverse()) {
    if (p.teardown) {
      try {
        await p.teardown();
      } catch (err) {
        console.warn(`[argusai] Plugin "${p.name}" teardown error: ${(err as Error).message}`);
      }
    }
  }
}
