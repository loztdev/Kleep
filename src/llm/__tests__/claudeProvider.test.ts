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

function toolUseStopMessage(name: string, input: unknown): Anthropic.Message {
  return {
    ...toolUseMessage(name, input),
    stop_reason: "tool_use",
  };
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

    expect(result).toMatchObject({ text: "hello", model: "claude-opus-4-8", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(result.stopReason).toBe("end_turn");
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

  it("forwards cacheTtl down to the Claude request's cache_control.ttl", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const provider = new ClaudeProvider(new ClaudeClient({ transport }));

    await provider.sendMessage({ messages: [{ role: "user", content: "hi" }], cache: true, cacheTtl: "1h" });
    expect(transport.calls[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
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
    expect(final).toMatchObject({ text: "hi there", model: "claude-opus-4-8", usage: { inputTokens: 10, outputTokens: 5 } });
  });

  describe("tool-use translation", () => {
    it("passes `tools` through to the Claude request in Anthropic's input_schema shape", async () => {
      const transport = new StubTransport(async () => textMessage("hello"));
      const provider = new ClaudeProvider(new ClaudeClient({ transport }));

      await provider.sendMessage({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "remember_fact",
            description: "store a fact",
            inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
          },
        ],
      });

      expect(transport.calls[0]!.tools).toEqual([
        {
          name: "remember_fact",
          description: "store a fact",
          input_schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
        },
      ]);
    });

    it("translates content-block messages (tool_use + tool_result) into Anthropic's block shape", async () => {
      const transport = new StubTransport(async () => textMessage("ok"));
      const provider = new ClaudeProvider(new ClaudeClient({ transport }));

      await provider.sendMessage({
        messages: [
          { role: "user", content: "remember my name is Aaron" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "sure" },
              { type: "tool_use", id: "toolu_1", name: "remember_fact", input: { content: "The user's name is Aaron." } },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", toolUseId: "toolu_1", content: "Remembered: The user's name is Aaron." },
            ],
          },
        ],
      });

      const req = transport.calls[0]!;
      // Assistant turn should carry text + tool_use blocks in Anthropic's tagged shape.
      const assistant = req.messages[1]!;
      expect(assistant.role).toBe("assistant");
      expect(Array.isArray(assistant.content)).toBe(true);
      const assistantBlocks = assistant.content as Anthropic.ContentBlockParam[];
      expect(assistantBlocks[0]).toEqual({ type: "text", text: "sure" });
      expect(assistantBlocks[1]).toEqual({
        type: "tool_use",
        id: "toolu_1",
        name: "remember_fact",
        input: { content: "The user's name is Aaron." },
      });

      // Follow-up user turn should carry the tool_result block, keyed by `tool_use_id`.
      const followupUser = req.messages[2]!;
      const userBlocks = followupUser.content as Anthropic.ContentBlockParam[];
      expect(userBlocks[0]).toEqual({
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "Remembered: The user's name is Aaron.",
      });
    });

    it("forwards is_error on a tool_result block only when set", async () => {
      const transport = new StubTransport(async () => textMessage("ok"));
      const provider = new ClaudeProvider(new ClaudeClient({ transport }));

      await provider.sendMessage({
        messages: [
          {
            role: "user",
            content: [
              { type: "tool_result", toolUseId: "toolu_1", content: "bad input", isError: true },
              { type: "tool_result", toolUseId: "toolu_2", content: "fine" },
            ],
          },
        ],
      });

      const blocks = transport.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[];
      expect(blocks[0]).toMatchObject({ is_error: true });
      expect((blocks[1] as { is_error?: boolean }).is_error).toBeUndefined();
    });

    it("extracts toolUses + stopReason='tool_use' when the model requests a tool call", async () => {
      const transport = new StubTransport(async () =>
        toolUseStopMessage("remember_fact", { content: "The user's name is Aaron." }),
      );
      const provider = new ClaudeProvider(new ClaudeClient({ transport }));

      const result = await provider.sendMessage({ messages: [{ role: "user", content: "remember my name" }] });

      expect(result.stopReason).toBe("tool_use");
      expect(result.toolUses).toEqual([
        { id: "toolu_1", name: "remember_fact", input: { content: "The user's name is Aaron." } },
      ]);
      // No text blocks in the response → empty string, not `undefined`.
      expect(result.text).toBe("");
    });
  });
});
