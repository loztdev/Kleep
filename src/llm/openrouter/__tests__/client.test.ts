import { z } from "zod";
import { OpenRouterClient, StructuredOutputError } from "../client";
import { OpenRouterApiError, OpenRouterEmptyResponseError } from "../types";
import type {
  OpenRouterMessageStream,
  OpenRouterRequest,
  OpenRouterRequestOptions,
  OpenRouterResponse,
  OpenRouterStreamChunk,
  OpenRouterTransport,
} from "../types";

function textResponse(content: string, overrides: Partial<OpenRouterResponse> = {}): OpenRouterResponse {
  return {
    id: "gen_1",
    model: "openai/gpt-4o-mini",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
    ...overrides,
  };
}

function toolCallResponse(name: string, args: unknown): OpenRouterResponse {
  return textResponse("", {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
}

class StubTransport implements OpenRouterTransport {
  calls: OpenRouterRequest[] = [];
  optsCalls: Array<OpenRouterRequestOptions | undefined> = [];
  constructor(private readonly impl: (req: OpenRouterRequest) => Promise<OpenRouterResponse>) {}
  send(req: OpenRouterRequest, opts?: OpenRouterRequestOptions): Promise<OpenRouterResponse> {
    this.calls.push(req);
    this.optsCalls.push(opts);
    return this.impl(req);
  }
  stream(): OpenRouterMessageStream {
    throw new Error("not implemented in StubTransport");
  }
}

describe("OpenRouterClient.sendMessage", () => {
  it("sends the request and records cost from the native usage.cost field", async () => {
    const transport = new StubTransport(async () => textResponse("hello"));
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    const result = await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });

    expect(result).toMatchObject({ text: "hello", model: "openai/gpt-4o-mini", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(client.costTracker.totalUsd()).toBeCloseTo(0.0001);
    expect(transport.calls[0]).toMatchObject({ model: "openai/gpt-4o-mini" });
  });

  it("prefers a per-call model over defaultModel", async () => {
    const transport = new StubTransport(async () => textResponse("hi"));
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], model: "anthropic/claude-3.5-haiku" });

    expect(transport.calls[0]!.model).toBe("anthropic/claude-3.5-haiku");
  });

  it("throws a clear error when no model is available", async () => {
    const transport = new StubTransport(async () => textResponse("hi"));
    const client = new OpenRouterClient({ transport });

    await expect(client.sendMessage({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/no model specified/);
  });

  it("puts `system` as a leading system-role message", async () => {
    const transport = new StubTransport(async (req) => {
      expect(req.messages[0]).toEqual({ role: "system", content: "be terse" });
      expect(req.messages[1]).toEqual({ role: "user", content: "hi" });
      return textResponse("ok");
    });
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], system: "be terse" });
  });

  it("omits cache_control by default", async () => {
    const transport = new StubTransport(async (req) => {
      expect(req.messages[0]).toEqual({ role: "user", content: "hi" });
      return textResponse("ok");
    });
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });
  });

  it("attaches cache_control to the system message and the newest message when `cache: true`", async () => {
    const transport = new StubTransport(async (req) => {
      expect(req.messages[0]).toEqual({
        role: "system",
        content: [{ type: "text", text: "be terse", cache_control: { type: "ephemeral" } }],
      });
      expect(req.messages[1]).toEqual({ role: "user", content: "turn one" });
      expect(req.messages[2]).toEqual({
        role: "user",
        content: [{ type: "text", text: "turn two", cache_control: { type: "ephemeral" } }],
      });
      return textResponse("ok");
    });
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await client.sendMessage({
      messages: [
        { role: "user", content: "turn one" },
        { role: "user", content: "turn two" },
      ],
      system: "be terse",
      cache: true,
    });
  });

  it("passes cacheTtl through to cache_control.ttl", async () => {
    const transport = new StubTransport(async (req) => {
      expect(req.messages[0]).toEqual({
        role: "user",
        content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "1h" } }],
      });
      return textResponse("ok");
    });
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], cache: true, cacheTtl: "1h" });
  });

  it("forwards responseCacheTtlSeconds to the transport as request options, omitting it by default", async () => {
    const transport = new StubTransport(async () => textResponse("ok"));
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });
    expect(transport.optsCalls[0]?.responseCacheTtlSeconds).toBeUndefined();

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], responseCacheTtlSeconds: 60 });
    expect(transport.optsCalls[1]?.responseCacheTtlSeconds).toBe(60);
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let attempts = 0;
    const transport = new StubTransport(async () => {
      attempts++;
      if (attempts < 3) throw new OpenRouterApiError(429, "rate limited");
      return textResponse("ok");
    });
    const sleeps: number[] = [];
    const client = new OpenRouterClient({
      transport,
      defaultModel: "openai/gpt-4o-mini",
      retry: { sleep: async (ms) => void sleeps.push(ms), jitter: () => 1, baseDelayMs: 100 },
    });

    const result = await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });

    expect(result.text).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("gives up after maxRetries", async () => {
    const transport = new StubTransport(async () => {
      throw new OpenRouterApiError(500, "server error");
    });
    const client = new OpenRouterClient({
      transport,
      defaultModel: "openai/gpt-4o-mini",
      retry: { maxRetries: 2, sleep: async () => undefined },
    });

    await expect(client.sendMessage({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(OpenRouterApiError);
    expect(transport.calls).toHaveLength(3);
  });

  it("does not retry a non-retryable (400) error", async () => {
    const transport = new StubTransport(async () => {
      throw new OpenRouterApiError(400, "bad request");
    });
    const client = new OpenRouterClient({
      transport,
      defaultModel: "openai/gpt-4o-mini",
      retry: { sleep: async () => undefined },
    });

    await expect(client.sendMessage({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(OpenRouterApiError);
    expect(transport.calls).toHaveLength(1);
  });

  it("throws OpenRouterEmptyResponseError when the assistant message has null content", async () => {
    const transport = new StubTransport(async () => ({
      id: "gen_1",
      model: "anthropic/claude-fable-5",
      choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "content_filter" }],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    }));
    const client = new OpenRouterClient({ transport, defaultModel: "anthropic/claude-fable-5" });

    await expect(
      client.sendMessage({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(OpenRouterEmptyResponseError);
    await expect(
      client.sendMessage({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/content_filter/);
  });

  it("throws OpenRouterEmptyResponseError when content is an empty string too", async () => {
    const transport = new StubTransport(async () => textResponse(""));
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await expect(
      client.sendMessage({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(OpenRouterEmptyResponseError);
  });

  describe("tool-use translation", () => {
    it("maps `tools` to the OpenAI function-calling shape in the request", async () => {
      const transport = new StubTransport(async () => textResponse("ok"));
      const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

      await client.sendMessage({
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
          type: "function",
          function: {
            name: "remember_fact",
            description: "store a fact",
            parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
          },
        },
      ]);
    });

    it("splits a block-array assistant turn into one message with text + tool_calls", async () => {
      const transport = new StubTransport(async () => textResponse("ok"));
      const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

      await client.sendMessage({
        messages: [
          { role: "user", content: "remember my name" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "sure" },
              { type: "tool_use", id: "call_1", name: "remember_fact", input: { content: "Aaron." } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", toolUseId: "call_1", content: "Remembered: Aaron." }],
          },
        ],
      });

      const req = transport.calls[0]!;
      // Assistant message: text on `content`, tool_calls alongside.
      expect(req.messages[1]).toEqual({
        role: "assistant",
        content: "sure",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "remember_fact", arguments: JSON.stringify({ content: "Aaron." }) } },
        ],
      });
      // Follow-up user turn fans out into a separate `role: "tool"` message per tool_result.
      expect(req.messages[2]).toEqual({ role: "tool", content: "Remembered: Aaron.", tool_call_id: "call_1" });
    });

    it("emits `content: null` on an assistant message that only produced tool_use blocks", async () => {
      const transport = new StubTransport(async () => textResponse("ok"));
      const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

      await client.sendMessage({
        messages: [
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call_1", name: "remember_fact", input: { content: "x" } }],
          },
        ],
      });

      const asstMsg = transport.calls[0]!.messages[0]!;
      expect(asstMsg.role).toBe("assistant");
      expect(asstMsg.content).toBeNull();
      expect(asstMsg.tool_calls).toHaveLength(1);
    });

    it("extracts toolUses + stopReason='tool_use' from a tool-only content:null response (no throw)", async () => {
      const transport = new StubTransport(async () => toolCallResponse("remember_fact", { content: "Aaron." }));
      const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

      const result = await client.sendMessage({ messages: [{ role: "user", content: "remember" }] });

      expect(result.text).toBe("");
      expect(result.stopReason).toBe("tool_use");
      expect(result.toolUses).toEqual([
        { id: "call_1", name: "remember_fact", input: { content: "Aaron." } },
      ]);
    });

    it("normalizes plain-text finish_reason='stop' to stopReason='end_turn'", async () => {
      const transport = new StubTransport(async () => textResponse("hi"));
      const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

      const result = await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });
      expect(result.stopReason).toBe("end_turn");
    });
  });
});

describe("OpenRouterClient.structured", () => {
  const FactSchema = z.object({ fact: z.string(), confidence: z.number() });

  it("forces the named tool via OpenAI function-calling shape and validates the arguments", async () => {
    const transport = new StubTransport(async (req) => {
      expect(req.tool_choice).toEqual({ type: "function", function: { name: "extract_fact" } });
      expect(req.tools?.[0]).toMatchObject({ type: "function", function: { name: "extract_fact" } });
      return toolCallResponse("extract_fact", { fact: "Mojo is a puppy.", confidence: 0.9 });
    });
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    const result = await client.structured({
      messages: [{ role: "user", content: "Mojo is a puppy." }],
      tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
    });

    expect(result.data).toEqual({ fact: "Mojo is a puppy.", confidence: 0.9 });
  });

  it("throws StructuredOutputError when no matching tool call is returned", async () => {
    const transport = new StubTransport(async () => textResponse("I won't."));
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await expect(
      client.structured({
        messages: [{ role: "user", content: "x" }],
        tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
      }),
    ).rejects.toThrow(StructuredOutputError);
  });

  it("throws StructuredOutputError when tool call arguments aren't valid JSON", async () => {
    const transport = new StubTransport(async () =>
      textResponse("", {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "extract_fact", arguments: "{not json" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await expect(
      client.structured({
        messages: [{ role: "user", content: "x" }],
        tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
      }),
    ).rejects.toThrow(StructuredOutputError);
  });

  it("throws StructuredOutputError when arguments fail schema validation", async () => {
    const transport = new StubTransport(async () => toolCallResponse("extract_fact", { fact: 123 }));
    const client = new OpenRouterClient({ transport, defaultModel: "openai/gpt-4o-mini" });

    await expect(
      client.structured({
        messages: [{ role: "user", content: "x" }],
        tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
      }),
    ).rejects.toThrow(StructuredOutputError);
  });
});

describe("OpenRouterClient.streamMessage", () => {
  it("yields text chunks and resolves final with cost recorded", async () => {
    const finalResponse = textResponse("hello world");
    const chunks: OpenRouterStreamChunk[] = [
      { id: "gen_1", model: "openai/gpt-4o-mini", choices: [{ index: 0, delta: { content: "hello " }, finish_reason: null }] },
      { id: "gen_1", model: "openai/gpt-4o-mini", choices: [{ index: 0, delta: { content: "world" }, finish_reason: "stop" }] },
    ];

    class StreamTransport implements OpenRouterTransport {
      send(): Promise<OpenRouterResponse> {
        throw new Error("unused");
      }
      stream(): OpenRouterMessageStream {
        return {
          [Symbol.asyncIterator]: () => {
            let i = 0;
            return { next: async () => (i < chunks.length ? { done: false, value: chunks[i++]! } : { done: true, value: undefined }) };
          },
          finalMessage: async () => finalResponse,
        };
      }
    }

    const client = new OpenRouterClient({ transport: new StreamTransport(), defaultModel: "openai/gpt-4o-mini" });
    const handle = client.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    const collected: string[] = [];
    for await (const chunk of handle.chunks) collected.push(chunk.text);
    const final = await handle.final;

    expect(collected.join("")).toBe("hello world");
    expect(final.text).toBe("hello world");
    expect(client.costTracker.totalUsd()).toBeCloseTo(0.0001);
  });

  it("does not crash the process when only `chunks` is consumed and the transport fails", async () => {
    // Regression: `final` is derived via `.then()` on the transport's own
    // promise — each `.then()` link needs its own unhandled-rejection
    // guard, or a caller that only drains `chunks` triggers a crash.
    const boom = new Error("stream exploded");
    class FailingTransport implements OpenRouterTransport {
      send(): Promise<OpenRouterResponse> {
        throw new Error("unused");
      }
      stream(): OpenRouterMessageStream {
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw boom;
            },
          }),
          finalMessage: async () => {
            throw boom;
          },
        };
      }
    }

    const client = new OpenRouterClient({ transport: new FailingTransport(), defaultModel: "openai/gpt-4o-mini" });
    const handle = client.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    await expect(
      (async () => {
        for await (const _chunk of handle.chunks) {
          // drain
        }
      })(),
    ).rejects.toThrow(boom);
    // Give the unattached `final` rejection a turn to surface as an
    // unhandled rejection if it were going to (it shouldn't).
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("OpenRouterClient construction", () => {
  it("throws when neither apiKey nor transport is given", () => {
    expect(() => new OpenRouterClient({})).toThrow();
  });

  it("accepts an apiKey and builds a RealOpenRouterTransport without making a call", () => {
    expect(() => new OpenRouterClient({ apiKey: "sk-or-test" })).not.toThrow();
  });
});
