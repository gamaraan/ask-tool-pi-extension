/**
 * Tool description served to the LLM.
 *
 * Ported from omp `packages/coding-agent/src/prompts/tools/ask.md` with the
 * omp-only instructions (TTS, terminal notifications, plan-mode) stripped and
 * the XML prompt-template tags flattened to markdown (pi serves tool
 * descriptions raw; it has no omp-style `prompt.render` template phase).
 * Reserved-label wording must stay verbatim — `schema.test.ts` pins it.
 */
export const ASK_TOOL_DESCRIPTION = `Ask user for clarification/input during task execution.

**When to use:**
- Multiple approaches with significantly different tradeoffs the user should weigh.

**Instructions:**
- \`recommended: <index>\` marks default (0-indexed); " (Recommended)" added automatically.
- Use \`questions\` for related questions, not one at a time.
- Set \`multi: true\` on a question to allow multiple selections.
- Short option labels; explanatory tradeoffs in \`description\`, not labels.

**Caution:**
- Provide 2-5 concise, distinct options.

**Critical:**
- Default to action. Resolve ambiguity via repo conventions, existing patterns, reasonable defaults. Exhaust existing sources (code, configs, docs, history) before asking. Ask only when options have materially different tradeoffs the user must decide.
- If multiple choices acceptable: pick most conservative/standard option; proceed; state choice.
- Do NOT include "Other"; UI automatically adds "Other (type your own)" to every question.
`;
