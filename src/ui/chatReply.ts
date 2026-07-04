/**
 * Generates the assistant's reply for the chat screen — a plain
 * conversational call through `LlmProvider.sendMessage`, deliberately
 * separate from `LlmExtractor`/`LlmSummarizer` (which read the
 * conversation, not drive it).
 */

import { TurnRole, type Turn } from "../conversation";
import type { LlmContentBlock, LlmMessage, LlmProvider, LlmToolResult } from "../llm";
import type { ToolRegistration } from "../memoryTools";
import type { SavedSkill } from "../storage";

const DEFAULT_SYSTEM_PROMPT = `You are Kleep, a warm, attentive conversational companion with a good memory for detail. Respond naturally to the user, drawing on what's been said earlier in the conversation. Keep replies conversational — a few sentences, not an essay — unless the user is clearly asking for something longer.`;

/**
 * User-configurable caching for chat replies — see `ConnectScreen`'s
 * caching section. `enabled`/`ttl` drive real (provider-side) prompt
 * caching (Claude directly, or Claude models via OpenRouter);
 * `responseCacheTtlSeconds` drives OpenRouter's separate exact-request
 * response cache and is ignored by `ClaudeProvider`. See `LlmSendOptions`
 * in `src/llm/types.ts` for what each actually does on the wire.
 */
export interface CacheSettings {
  enabled: boolean;
  ttl?: "5m" | "1h";
  responseCacheTtlSeconds?: number;
}

/** Default caching behavior: real prompt caching on (5m), response caching off. */
export const DEFAULT_CACHE_SETTINGS: CacheSettings = { enabled: true };

/** Cap on how many round-trips a single reply can spend inside the tool-use
 * loop. Guards against runaway `tool_use → tool_result → tool_use → ...`
 * cycles that a misbehaving model could otherwise stretch forever. Ten is
 * generous for any realistic conversational tool set (remember, retrieve,
 * link) and low enough that a runaway pays cost/latency for its mistake. */
const MAX_TOOL_ROUNDS = 10;

/**
 * Compose the effective system message. Layer order from front to back:
 *
 *   [jailbreak]  ← establishes what's allowed
 *   [persona]    ← decides how the model sounds
 *   [skills]     ← task-specific guidance the model should apply on trigger
 *
 * Persona-last vs jailbreak keeps the "permissions floor" from being reset
 * by whatever the persona says. Skills-last vs persona keeps the persona's
 * *voice* setting the baseline while a triggered skill overlays its
 * task-specific rules on top. Every layer degrades gracefully — empty/
 * whitespace-only strings and empty arrays are all treated as "not set,"
 * so callers can pass `undefined`, `""`, or `[]` interchangeably. Both
 * slots empty and no skills falls back to the built-in Kleep persona.
 */
export function composeSystemPrompt(
  jailbreakPrompt?: string,
  systemPrompt?: string,
  activeSkills?: readonly SavedSkill[],
): string {
  const jb = jailbreakPrompt?.trim() ?? "";
  const persona = systemPrompt?.trim() ?? "";
  const skills = (activeSkills ?? []).filter((s) => s.body.trim().length > 0);

  const parts: string[] = [];
  if (jb) parts.push(jb);
  if (persona) parts.push(persona);
  if (parts.length === 0 && skills.length === 0) parts.push(DEFAULT_SYSTEM_PROMPT);
  if (skills.length > 0) parts.push(renderSkillsBlock(skills));
  return parts.join("\n\n");
}

/** Render the "skills" block that gets appended to the system prompt.
 * Each skill goes in with its name as a heading, its whenToUse as a
 * trigger hint, and its body. Kept compact — no bullet noise around
 * the body — so a five-skill chat doesn't blow past the model's system-
 * prompt sweet spot. */
function renderSkillsBlock(skills: readonly SavedSkill[]): string {
  const rendered = skills
    .map((s) => `## ${s.name}\n\n_Apply when: ${s.whenToUse}_\n\n${s.body}`)
    .join("\n\n---\n\n");
  return `# Skills\n\nThe following skills are active for this conversation. Apply each when its \`when to use\` condition is met — silently, without narrating that you're doing so.\n\n${rendered}`;
}

/**
 * Turn the live conversation into a reply from `provider`. `systemPrompt`
 * fully replaces Kleep's built-in persona when set (Tier 7.6) — a user
 * who deliberately picks/writes a system prompt wants that prompt, not
 * a personality blended with it — falling back to the default only
 * when no override is in effect for this chat. `jailbreakPrompt`, when
 * present, is prepended in front of whichever of those two lands.
 *
 * When `tools` is non-empty the call becomes a *tool-use loop*: after each
 * response with `tool_use` blocks we execute the requested tools locally,
 * feed the results back as the next user turn, and re-invoke the model.
 * The loop ends when the model responds with plain text (no more tool_use)
 * or when `MAX_TOOL_ROUNDS` is reached (defensive cap against runaway).
 */
export async function generateReply(
  provider: LlmProvider,
  turns: readonly Turn[],
  systemPrompt?: string,
  cacheSettings: CacheSettings = DEFAULT_CACHE_SETTINGS,
  jailbreakPrompt?: string,
  activeSkills?: readonly SavedSkill[],
  tools?: readonly ToolRegistration[],
): Promise<string> {
  const initialMessages: LlmMessage[] = turns
    .filter((t): t is Turn & { role: typeof TurnRole.USER | typeof TurnRole.ASSISTANT } =>
      t.role === TurnRole.USER || t.role === TurnRole.ASSISTANT,
    )
    .map((t) => ({ role: t.role === TurnRole.USER ? "user" : "assistant", content: t.content }));

  const toolDefinitions = tools?.map((t) => t.definition);
  const toolsByName = new Map((tools ?? []).map((t) => [t.definition.name, t]));

  // Running message list — grows as the tool loop appends assistant tool_use
  // turns and follow-up user tool_result turns.
  let messages: LlmMessage[] = initialMessages;
  let accumulatedText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await provider.sendMessage({
      messages,
      system: composeSystemPrompt(jailbreakPrompt, systemPrompt, activeSkills),
      // Undefined = each provider's own default. Chat surface no longer
      // hardcodes a low cap — reasoning models spend output tokens on
      // thinking before the visible reply and any hardcoded value here
      // clips them mid-thought. The user-configurable `maxOutputTokens`
      // setting is applied from a follow-up PR at a higher layer.
      cache: cacheSettings.enabled,
      ...(cacheSettings.ttl ? { cacheTtl: cacheSettings.ttl } : {}),
      ...(cacheSettings.responseCacheTtlSeconds !== undefined
        ? { responseCacheTtlSeconds: cacheSettings.responseCacheTtlSeconds }
        : {}),
      ...(toolDefinitions && toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
    });

    if (result.text) accumulatedText = result.text;

    const toolUses = result.toolUses ?? [];
    if (toolUses.length === 0) {
      // Model finished with plain text — return whatever it produced.
      return result.text;
    }

    // Model wants to call tools. Execute each in sequence — parallelizing is
    // tempting but a "remember A then forget A" pair could race; sequential
    // execution matches the order the model requested and keeps store writes
    // deterministic. Then feed the results back for the next round.
    const toolResults: LlmToolResult[] = [];
    for (const use of toolUses) {
      const registration = toolsByName.get(use.name);
      if (!registration) {
        toolResults.push({
          toolUseId: use.id,
          content: `Unknown tool: ${use.name}. Nothing was done.`,
          isError: true,
        });
        continue;
      }
      try {
        const outcome = await registration.execute(use.input);
        toolResults.push({
          toolUseId: use.id,
          content: outcome.content,
          ...(outcome.isError ? { isError: true } : {}),
        });
      } catch (err) {
        toolResults.push({
          toolUseId: use.id,
          content: `Tool ${use.name} threw: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        });
      }
    }

    // Append the assistant turn (with its text + tool_use blocks) and the
    // matching user turn (with the tool_result blocks). Order matters —
    // both providers require tool_use blocks to appear before their paired
    // tool_result blocks in the conversation.
    const assistantBlocks: LlmContentBlock[] = [];
    if (result.text) assistantBlocks.push({ type: "text", text: result.text });
    for (const use of toolUses) {
      assistantBlocks.push({ type: "tool_use", id: use.id, name: use.name, input: use.input });
    }
    const userBlocks: LlmContentBlock[] = toolResults.map((r) => ({
      type: "tool_result",
      toolUseId: r.toolUseId,
      content: r.content,
      ...(r.isError ? { isError: true } : {}),
    }));
    messages = [
      ...messages,
      { role: "assistant", content: assistantBlocks },
      { role: "user", content: userBlocks },
    ];
  }

  // Fell out of the loop — model kept requesting tool calls past the cap.
  // Return whatever text we last saw so the UI at least renders something
  // instead of dead silence; a defensive log flags the situation.
  console.warn(
    `generateReply: hit MAX_TOOL_ROUNDS (${MAX_TOOL_ROUNDS}) without a plain-text reply. Model may be stuck in a tool loop.`,
  );
  return accumulatedText;
}
