/**
 * @module agent-assertions/llm-judge
 * LLM-as-judge: use a cheap LLM to evaluate agent behavior.
 *
 * Sends the session transcript + goal to a judge model and gets a
 * structured evaluation (completed, score, issues).
 *
 * This is Tier 2 assertion — more expensive but handles open-ended tasks
 * where programmatic assertions can't determine semantic correctness.
 */

export interface JudgeOptions {
  /** The original goal/task given to the agent */
  goal: string;
  /** The session transcript (array of messages) */
  transcript: Array<{ role: string; content: string; tool_calls?: unknown[] }>;
  /** Final workspace state description (e.g., file listing) */
  workspaceState?: string;
  /** LLM API base URL (default: https://api.deepseek.com/v1) */
  apiBase?: string;
  /** LLM API key */
  apiKey?: string;
  /** Model to use for judging (default: deepseek-chat) */
  model?: string;
  /** Custom judge prompt (overrides default) */
  customPrompt?: string;
}

export interface JudgeResult {
  /** Whether the agent completed the task goal */
  completed: boolean;
  /** Quality score 1-5 */
  score: number;
  /** Whether there were obvious issues (loops, errors, wasted steps) */
  hasIssues: boolean;
  /** Free-text explanation from the judge */
  reason: string;
  /** Raw judge response (for debugging) */
  raw: string;
}

const DEFAULT_JUDGE_PROMPT = `You are an impartial evaluator assessing whether an AI agent successfully completed its assigned task.

## Task Goal
{goal}

## Agent Transcript
{transcript}

{workspace_section}

## Evaluation Criteria
1. **Completion**: Did the agent achieve the stated goal?
2. **Efficiency**: Were there unnecessary loops, errors, or wasted steps?
3. **Quality**: Is the output correct and complete?

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "completed": true/false,
  "score": 1-5,
  "has_issues": true/false,
  "reason": "1-2 sentence explanation"
}

Score guide:
- 5: Perfect execution, goal fully achieved efficiently
- 4: Goal achieved with minor inefficiencies
- 3: Goal partially achieved or achieved with significant issues
- 2: Goal mostly not achieved but showed progress
- 1: Complete failure or stuck in loops`;

/**
 * Use an LLM to judge agent behavior.
 *
 * @param options - Judge configuration and input
 * @returns Structured evaluation result
 */
export async function judgeLlm(options: JudgeOptions): Promise<JudgeResult> {
  const apiBase = options.apiBase ?? process.env.JUDGE_API_BASE ?? 'https://api.deepseek.com/v1';
  const apiKey = options.apiKey ?? process.env.JUDGE_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  const model = options.model ?? process.env.JUDGE_MODEL ?? 'deepseek-chat';

  if (!apiKey) {
    throw new Error('LLM judge requires an API key (set JUDGE_API_KEY or DEEPSEEK_API_KEY)');
  }

  // Build transcript summary (truncate to avoid excessive cost)
  const transcriptText = options.transcript
    .map((msg, i) => {
      const toolInfo = msg.tool_calls?.length
        ? ` [calls: ${(msg.tool_calls as Array<{name?: string}>).map(t => t.name ?? '?').join(', ')}]`
        : '';
      const content = msg.content.length > 500
        ? msg.content.slice(0, 500) + '...'
        : msg.content;
      return `[${i}] ${msg.role}${toolInfo}: ${content}`;
    })
    .join('\n');

  const workspaceSection = options.workspaceState
    ? `## Workspace State After Execution\n${options.workspaceState}`
    : '';

  const prompt = (options.customPrompt ?? DEFAULT_JUDGE_PROMPT)
    .replace('{goal}', options.goal)
    .replace('{transcript}', transcriptText)
    .replace('{workspace_section}', workspaceSection);

  // Call LLM
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge LLM call failed: HTTP ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';

  // Parse judge response
  try {
    // Extract JSON from potentially markdown-wrapped response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { completed: false, score: 0, hasIssues: true, reason: 'Judge returned non-JSON response', raw };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      completed?: boolean;
      score?: number;
      has_issues?: boolean;
      reason?: string;
    };

    return {
      completed: parsed.completed ?? false,
      score: parsed.score ?? 0,
      hasIssues: parsed.has_issues ?? true,
      reason: parsed.reason ?? 'No reason provided',
      raw,
    };
  } catch {
    return { completed: false, score: 0, hasIssues: true, reason: `Failed to parse judge response: ${raw}`, raw };
  }
}
