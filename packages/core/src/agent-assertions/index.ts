/**
 * @module agent-assertions
 * Assertion extensions for AI Agent testing.
 *
 * Provides specialized assertions for verifying agent behavior through
 * observable outputs: workspace files, session transcripts, cost data,
 * and semantic evaluation via LLM-as-judge.
 *
 * Designed for use with the exec/shell runners — after an agent completes
 * a task, these assertions validate what it left behind.
 */

export { assertFile, assertFileContent, assertFileJson, assertFileNotExists } from './file-assertions.js';
export { assertSession, assertSessionMessages, assertSessionToolCalls, parseSessionTranscript, type SessionAssertionOptions, type TranscriptMessage } from './session-assertions.js';
export { assertCost, type CostAssertionOptions } from './cost-assertions.js';
export { judgeLlm, type JudgeOptions, type JudgeResult } from './llm-judge.js';
export { AgentTestRunner, type AgentTestConfig, type AgentAssertions } from './agent-runner.js';
