/**
 * @module agent-assertions
 * Assertion extensions for AI Agent testing.
 *
 * ## Migration Notice
 *
 * The generic assertions (`assertFile*`, `judgeLlm`) have been promoted to
 * the core assertion engine and are re-exported here for backward compatibility.
 * Import them directly from `assertion-engine` or the package root going forward.
 *
 * The Recursive-agent-specific assertions (`assertSession`, `assertCost`,
 * `AgentTestRunner`) remain here for migration purposes.
 * New projects should implement these as {@link AssertionPlugin} instances
 * registered with {@link AssertionPluginRegistry} instead of depending on this module.
 *
 * @deprecated Use `assertFile*` and `judgeLlm` from the package root.
 * Implement agent-specific assertions as `AssertionPlugin` plugins.
 */

// Generic file assertions — promoted to assertion-engine
export {
  assertFile,
  assertFileContent,
  assertFileJson,
  assertFileNotExists,
} from '../assertion-engine.js';

// LLM-as-judge — promoted to assertion-engine
export {
  judgeLlm,
  type JudgeOptions,
  type JudgeResult,
} from '../assertion-engine.js';

// -----------------------------------------------------------------------
// Recursive-agent-specific assertions (kept for migration)
// New code should implement AssertionPlugin instead.
// -----------------------------------------------------------------------

/**
 * @deprecated Implement as an AssertionPlugin registered with AssertionPluginRegistry.
 * This module is specific to the Recursive agent session format.
 */
export {
  assertSession,
  assertSessionMessages,
  assertSessionToolCalls,
  parseSessionTranscript,
  type SessionAssertionOptions,
  type TranscriptMessage,
} from './session-assertions.js';

/**
 * @deprecated Implement as an AssertionPlugin registered with AssertionPluginRegistry.
 * This module is specific to the Recursive agent CostTracker output format.
 */
export {
  assertCost,
  type CostAssertionOptions,
} from './cost-assertions.js';

/**
 * @deprecated Implement as an AssertionPlugin registered with AssertionPluginRegistry.
 * This runner is specific to the Recursive agent binary execution model.
 */
export {
  AgentTestRunner,
  type AgentTestConfig,
  type AgentAssertions,
} from './agent-runner.js';
