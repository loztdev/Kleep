import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ClaudeClient } from "../../claude";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "../../claude";
import { ClaudeProvider } from "../claudeProvider";

function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message;
}

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return { ...textMessage(""), content: [{ type: "tool_use", id: "toolu_1", name, input, caller: { type: "direct" } }] };
}

class StubTransport implements ClaudeTransport {
  calls: ClaudeRequest[] = [];
  constructor(private readonly impl: (req: ClaudeRequest) => Promise<Anthropic.Message>) {}
  send(req: ClaudeRequest): Promise<Anthropic.Message> {
    this.calls.push(req);
    return this.impl(req);
  }
  stream(): ClaudeMessageStream {
    throw new Error("not used");
  }
}

describe("ClaudeProvider", () => {
  it("adapts sendMessage to the generic LlmTextResult shape", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const provider = new ClaudeProvider(new ClaudeClient({ transport }));

    const result = await provider.sendMessage({ messages: [{ role: "user", content: "hi" }] });

    expect(result).toEqual({ text: "hello", model: "claude-opus-4-8", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(provider.name).toBe("claude");
  });

  it("forwards `cache: true` down to the Claude request's cache_control", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const provider = new ClaudeProvider(new ClaudeClient({ transport }));

    await provider.sendMessage({ messages: [{ role: "user", content: "hi" }] });
    expect(transport.calls[0]!.cache_control).toBeUndefined();

    await provider.sendMessage({ messages: [{ role: "user", content: "hi" }], cache: true });
    expect(transport.calls[1]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("adapts structured() — Zod schema is reused as-is", async () => {
    const transport = new StubTransport(async () => toolUseMessage("pick", { value: 7 }));
    const provider = new ClaudeProvider(new ClaudeClient({ transport }));

    const result = await provider.structured({
      messages: [{ role: "user", content: "x" }],
      tool: { name: "pick", description: "pick a number", schema: z.object({ value: z.number() }) },
    });

    expect(result.data).toEqual({ value: 7 });
  });

  it("tracks total cost via the wrapped client's costTracker", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const provider = new ClaudeProvider(new ClaudeClient({ transport }));

    expect(provider.totalCostUsd()).toBe(0);
    await provider.sendMessage({ messages: [{ role: "user", content: "hi" }] });
    expect(provider.totalCostUsd()).toBeGreaterThan(0);
  });

  it("adapts streamMessage — text-only chunks, final mapped to LlmTextResult", async () => {
    const finalMsg = textMessage("hi there");
    class StreamTransport implements ClaudeTransport {
      send(): Promise<Anthropic.Message> {
        throw new Error("unused");
      }
      stream(): ClaudeMessageStream {
        const events: Anthropic.MessageStreamEvent[] = [
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi " } } as never,
          { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "skip" } } as never,
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "there" } } as never,
        ];
        return {
          [Symbol.asyncIterator]: () => {
            let i = 0;
            return {
              next: async () =>
                i < events.length ? { done: false, value: events[i++]! } : { done: true, value: undefined },
            };
          },
          finalMessage: async () => finalMsg,
        };
      }
    }

    const provider = new ClaudeProvider(new ClaudeClient({ transport: new StreamTransport() }));
    const handle = provider.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    const collected: string[] = [];
    for await (const chunk of handle.chunks) collected.push(chunk.text);
    const final = await handle.final;

    expect(collected.join("")).toBe("hi there");
    expect(final).toEqual({ text: "hi there", model: "claude-opus-4-8", usage: { inputTokens: 10, outputTokens: 5 } });
  });
});
