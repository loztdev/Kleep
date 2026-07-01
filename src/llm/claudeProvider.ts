/**
 * Adapter: makes `ClaudeClient` satisfy the generic `LlmProvider` surface.
 *
 * `ClaudeClient` stays Anthropic-native (content blocks, tool_use blocks,
 * its own cost tracker) — this just translates at the boundary so
 * provider-agnostic callers (extraction, summarization, the chat screen)
 * never see an `Anthropic.Message`.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient } from "../claude";
import type {
  LlmMessage,
  LlmProvider,
  LlmSendOptions,
  LlmStreamChunk,
  LlmStreamHandle,
  LlmStructuredOptions,
  LlmStructuredResult,
  LlmTextResult,
} from "./types";

export class ClaudeProvider implements LlmProvider {
  readonly name = "claude";

  constructor(private readonly client: ClaudeClient) {}

  totalCostUsd(): number {
    return this.client.costTracker.totalUsd();
  }

  async sendMessage(opts: LlmSendOptions): Promise<LlmTextResult> {
    const message = await this.client.sendMessage(toClaudeSendOptions(opts));
    return toLlmTextResult(message);
  }

  async structured<T>(opts: LlmStructuredOptions<T>): Promise<LlmStructuredResult<T>> {
    const result = await this.client.structured({ ...toClaudeSendOptions(opts), tool: opts.tool });
    return { data: result.data };
  }

  streamMessage(opts: LlmSendOptions): LlmStreamHandle {
    const handle = this.client.streamMessage(toClaudeSendOptions(opts));

    async function* chunks(): AsyncGenerator<LlmStreamChunk, void, void> {
      for await (const chunk of handle.chunks) {
        if (chunk.type === "text") yield { type: "text", text: chunk.text };
      }
    }

    return { chunks: chunks(), final: handle.final.then(toLlmTextResult) };
  }
}

function toClaudeMessageParam(message: LlmMessage): Anthropic.MessageParam {
  return { role: message.role, content: message.content };
}

function toClaudeSendOptions(opts: LlmSendOptions): {
  messages: Anthropic.MessageParam[];
  system?: string;
  model?: string;
  maxTokens?: number;
} {
  return {
    messages: opts.messages.map(toClaudeMessageParam),
    ...(opts.system !== undefined ? { system: opts.system } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  };
}

function toLlmTextResult(message: Anthropic.Message): LlmTextResult {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    model: message.model,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  };
}
