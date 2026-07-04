/**
 * Generates the assistant's reply for the chat screen — a plain
 * conversational call through `LlmProvider.sendMessage`, deliberately
 * separate from `LlmExtractor`/`LlmSummarizer` (which read the
 * conversation, not drive it).
 */

import { TurnRole, type Turn } from "../conversation";
import type { LlmMessage, LlmProvider } from "../llm";

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

/**
 * Turn the live conversation into a reply from `provider`. `systemPrompt`
 * fully replaces Kleep's built-in persona when set (Tier 7.6) — a user
 * who deliberately picks/writes a system prompt wants that prompt, not
 * a personality blended with it — falling back to the default only
 * when no override is in effect for this chat.
 */
export async function generateReply(
  provider: LlmProvider,
  turns: readonly Turn[],
  systemPrompt?: string,
  cacheSettings: CacheSettings = DEFAULT_CACHE_SETTINGS,
): Promise<string> {
  const messages: LlmMessage[] = turns
    .filter((t): t is Turn & { role: typeof TurnRole.USER | typeof TurnRole.ASSISTANT } =>
      t.role === TurnRole.USER || t.role === TurnRole.ASSISTANT,
    )
    .map((t) => ({ role: t.role === TurnRole.USER ? "user" : "assistant", content: t.content }));

  const result = await provider.sendMessage({
    messages,
    system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    maxTokens: 500,
    // `messages` grows every turn, so once the conversation crosses the
    // model's minimum cacheable token count, later turns get cheaper,
    // faster reprocessing of the earlier history.
    cache: cacheSettings.enabled,
    ...(cacheSettings.ttl ? { cacheTtl: cacheSettings.ttl } : {}),
    ...(cacheSettings.responseCacheTtlSeconds !== undefined
      ? { responseCacheTtlSeconds: cacheSettings.responseCacheTtlSeconds }
      : {}),
  });
  return result.text;
}
