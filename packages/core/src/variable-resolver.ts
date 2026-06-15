/**
 * @module variable-resolver
 * Template variable resolution for YAML test files.
 * Supports {{env.XXX}}, {{config.xxx}}, {{timestamp}}, {{uuid}}, {{date}},
 * and runtime variables in template strings and nested objects.
 *
 * ## Variable namespaces
 *
 * | Syntax            | Source                                    | Example                      |
 * |-------------------|-------------------------------------------|------------------------------|
 * | `{{env.NAME}}`    | `process.env.NAME`                        | `{{env.API_KEY}}`            |
 * | `{{config.key}}`  | `service.vars` / `services[n].vars`       | `{{config.base_url}}`        |
 * | `{{runtime.key}}` | values saved with `save:` in prior steps  | `{{runtime.login_token}}`    |
 * | `{{timestamp}}`   | `Date.now()`                              | `{{timestamp}}`              |
 * | `{{uuid}}`        | `crypto.randomUUID()`                     | `{{uuid}}`                   |
 * | `{{date}}`        | today as `YYYY-MM-DD`                     | `{{date}}`                   |
 *
 * ### Important: `{{config.*}}` semantics (F10 note)
 *
 * Despite the name "config", `{{config.xxx}}` resolves from **service.vars** —
 * not from global config fields like `project.name` or `history.enabled`.
 * The key space maps directly to the `vars:` block under the active service:
 *
 * ```yaml
 * service:
 *   vars:
 *     base_url: "http://localhost:3000"   # → {{config.base_url}}
 *     auth_token: "secret"               # → {{config.auth_token}}
 * ```
 *
 * In multi-service projects, `{{config.*}}` resolves from the **target suite's
 * service** (controlled by `tests.suites[n].service`). All services' vars are
 * merged if no specific service is targeted — later entries overwrite earlier
 * ones when keys collide, so use unique key names across services.
 */

import crypto from 'node:crypto';
import type { E2EConfig, VariableContext } from './types.js';

/**
 * Replace `{{xxx}}` template variables in a string.
 *
 * Supported variable patterns:
 * - `{{timestamp}}` → `Date.now()` (milliseconds since epoch)
 * - `{{uuid}}` → `crypto.randomUUID()` (v4 UUID)
 * - `{{date}}` → current date in `YYYY-MM-DD` format
 * - `{{env.XXX}}` → value of `process.env.XXX` via context
 * - `{{config.xxx}}` → config-level variables from `service.vars`
 * - `{{xxx}}` → runtime variables (e.g., saved from previous test steps)
 *
 * Undefined variables are preserved as-is (e.g., `{{unknown}}` stays `{{unknown}}`).
 *
 * @param template - String containing `{{xxx}}` placeholders
 * @param context - Variable context with config, runtime, and env values
 * @returns String with variables resolved
 */
export function resolveVariables(template: string, context: VariableContext): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();

    // Built-in variables
    if (trimmed === 'timestamp') {
      return String(Date.now());
    }
    if (trimmed === 'uuid') {
      return crypto.randomUUID();
    }
    if (trimmed === 'date') {
      return new Date().toISOString().split('T')[0]!;
    }

    // Environment variables: {{env.XXX}}
    if (trimmed.startsWith('env.')) {
      const envKey = trimmed.slice(4);
      const value = context.env[envKey];
      if (value !== undefined) {
        return value;
      }
      return `{{${trimmed}}}`;
    }

    // Config variables: {{config.xxx}}
    if (trimmed.startsWith('config.')) {
      const configKey = trimmed.slice(7);
      const value = context.config[configKey];
      if (value !== undefined) {
        return value;
      }
      return `{{${trimmed}}}`;
    }

    // Runtime variables: {{runtime.xxx}} explicit prefix or {{xxx}} shorthand
    const runtimeKey = trimmed.startsWith('runtime.') ? trimmed.slice(8) : trimmed;
    const runtimeValue = context.runtime[runtimeKey];
    if (runtimeValue !== undefined) {
      return runtimeValue;
    }

    // Unknown variable — preserve original template
    return `{{${trimmed}}}`;
  });
}

/**
 * Recursively resolve template variables in an object, array, or string.
 *
 * - **Strings**: apply `resolveVariables`
 * - **Arrays**: recursively resolve each element
 * - **Objects**: recursively resolve each value (keys are NOT resolved)
 * - **Primitives** (number, boolean, null, undefined): returned as-is
 *
 * @param obj - Value to resolve (can be any type)
 * @param context - Variable context
 * @returns Resolved value with the same structure
 */
export function resolveObjectVariables(obj: unknown, context: VariableContext): unknown {
  if (typeof obj === 'string') {
    return resolveVariables(obj, context);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveObjectVariables(item, context));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveObjectVariables(value, context);
    }
    return result;
  }

  // Primitive types (number, boolean, null, undefined) — return as-is
  return obj;
}

/**
 * Create a {@link VariableContext} from an {@link E2EConfig}.
 *
 * Extracts `service.vars` as config variables and captures current
 * `process.env` as environment variables. Runtime variables are
 * initialized as an empty record (populated during test execution).
 *
 * @param config - E2E configuration
 * @returns VariableContext ready for variable resolution
 */
export function createVariableContext(config: E2EConfig): VariableContext {
  return {
    config: config.service?.vars ?? {},
    runtime: {},
    env: { ...process.env } as Record<string, string>,
  };
}
