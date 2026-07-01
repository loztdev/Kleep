/**
 * Generates the assistant's reply for the chat screen — a plain
 * conversational call through `LlmProvider.sendMessage`, deliberately
 * separate from `LlmExtractor`/`LlmSummarizer` (which read the
 * conversation, not drive it).
 */

import { TurnRole, type Turn } from "../conversation";
import type { LlmMessage, LlmProvider } from "../llm";

const SYSTEM_PROMPT = `You are Kleep, a warm, attentive conversational companion with a good memory for detail. Respond naturally to the user, drawing on what's been said earlier in the conversation. Keep replies conversational — a few sentences, not an essay — unless the user is clearly asking for something longer.`;

/** Turn the live conversation into a reply from `provider`. */
export async function generateReply(provider: LlmProvider, turns: readonly Turn[]): Promise<string> {
  const messages: LlmMessage[] = turns
    .filter((t): t is Turn & { role: typeof TurnRole.USER | typeof TurnRole.ASSISTANT } =>
      t.role === TurnRole.USER || t.role === TurnRole.ASSISTANT,
    )
    .map((t) => ({ role: t.role === TurnRole.USER ? "user" : "assistant", content: t.content }));

  const result = await provider.sendMessage({ messages, system: SYSTEM_PROMPT, maxTokens: 500 });
  return result.text;
}
