/**
 * Adapter: makes `ClaudeClient` satisfy the generic `LlmProvider` surface.
 *
 * `ClaudeClient` stays Anthropic-native (content blocks, tool_use blocks,
 * its own cost tracker) — this just translates at the boundary so
 * provider-agnostic callers (extraction, summarization, the chat screen)
 * never see an `Anthropic.Message`. Tool-use flow (Tier 7.7): callers pass
 * `tools` in `LlmSendOptions`; if the model responds with `tool_use` blocks
 * we surface them as `LlmToolUse[]` and set `stopReason: "tool_use"` so the
 * caller can execute them and continue the loop.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient } from "../claude";
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmSendOptions,
  LlmStopReason,
  LlmStreamChunk,
  LlmStreamHandle,
  LlmStructuredOptions,
  LlmStructuredResult,
  LlmTextResult,
  LlmToolUse,
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

/** Translate a generic `LlmMessage` into Anthropic's `MessageParam`. Plain
 * string content passes through as-is; a content-block array is mapped block-
 * for-block into Anthropic's tagged-union content shape. */
function toClaudeMessageParam(message: LlmMessage): Anthropic.MessageParam {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  const blocks: Anthropic.ContentBlockParam[] = message.content.map(toClaudeContentBlock);
  return { role: message.role, content: blocks };
}

function toClaudeContentBlock(block: LlmContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
  }
}

function toClaudeTool(def: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.inputSchema as Anthropic.Tool.InputSchema,
  };
}

function toClaudeSendOptions(opts: LlmSendOptions): {
  messages: Anthropic.MessageParam[];
  system?: string;
  model?: string;
  maxTokens?: number;
  cache?: boolean;
  cacheTtl?: "5m" | "1h";
  tools?: Anthropic.Tool[];
} {
  return {
    messages: opts.messages.map(toClaudeMessageParam),
    ...(opts.system !== undefined ? { system: opts.system } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.cache !== undefined ? { cache: opts.cache } : {}),
    ...(opts.cacheTtl !== undefined ? { cacheTtl: opts.cacheTtl } : {}),
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools.map(toClaudeTool) } : {}),
  };
}

function toLlmStopReason(stop: Anthropic.Message["stop_reason"]): LlmStopReason {
  switch (stop) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "other";
  }
}

function toLlmTextResult(message: Anthropic.Message): LlmTextResult {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolUses: LlmToolUse[] = message.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return {
    text,
    model: message.model,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    ...(toolUses.length > 0 ? { toolUses } : {}),
    stopReason: toLlmStopReason(message.stop_reason),
  };
}
