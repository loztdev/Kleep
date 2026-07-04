import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { z } from "zod";
import { ClaudeClient, StructuredOutputError } from "../client";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "../types";

function textMessage(text: string, opts: Partial<Anthropic.Message> = {}): Anthropic.Message {
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
      input_tokens: 100,
      output_tokens: 50,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...opts,
  } as Anthropic.Message;
}

function toolUseMessage(name: string, input: unknown): Anthropic.Message {
  return textMessage("", {
    content: [{ type: "tool_use", id: "toolu_1", name, input, caller: { type: "direct" } }],
  });
}

class StubTransport implements ClaudeTransport {
  public sendCalls: ClaudeRequest[] = [];
  constructor(private readonly impl: (req: ClaudeRequest) => Promise<Anthropic.Message>) {}

  send(req: ClaudeRequest): Promise<Anthropic.Message> {
    this.sendCalls.push(req);
    return this.impl(req);
  }

  stream(_req: ClaudeRequest): ClaudeMessageStream {
    throw new Error("not implemented in StubTransport");
  }
}

function rateLimitError(): APIError {
  return new APIError(429, { type: "rate_limit_error", message: "slow down" }, "slow down", undefined);
}

function badRequestError(): APIError {
  return new APIError(400, { type: "invalid_request_error", message: "nope" }, "nope", undefined);
}

describe("ClaudeClient.sendMessage", () => {
  it("sends the request through the transport and records cost", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const client = new ClaudeClient({ transport });

    const message = await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });

    expect(message.content[0]).toMatchObject({ type: "text", text: "hello" });
    expect(transport.sendCalls).toHaveLength(1);
    expect(transport.sendCalls[0]!.model).toBe("claude-opus-4-8");
    expect(client.costTracker.history()).toHaveLength(1);
    expect(client.costTracker.totalUsd()).toBeCloseTo((100 * 5 + 50 * 25) / 1_000_000);
  });

  it("applies defaultModel and defaultMaxTokens", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const client = new ClaudeClient({ transport, defaultModel: "claude-haiku-4-5", defaultMaxTokens: 222 });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });

    expect(transport.sendCalls[0]).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 222 });
  });

  it("substitutes a high fallback when maxTokens is 0 (the app's `unlimited` sentinel — Anthropic requires max_tokens)", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const client = new ClaudeClient({ transport, defaultModel: "claude-opus-4-7" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], maxTokens: 0 });

    // Should be a large integer, not 0 (which the API rejects) and not the
    // client's defaultMaxTokens (which would be aggressively short).
    expect(transport.sendCalls[0]?.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it("passes a positive maxTokens through verbatim", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const client = new ClaudeClient({ transport, defaultModel: "claude-opus-4-7" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], maxTokens: 65536 });

    expect(transport.sendCalls[0]?.max_tokens).toBe(65536);
  });

  it("omits cache_control by default, and sets it when `cache: true` is requested", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const client = new ClaudeClient({ transport });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });
    expect(transport.sendCalls[0]!.cache_control).toBeUndefined();

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], cache: true });
    expect(transport.sendCalls[1]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("passes cacheTtl through to cache_control.ttl, omitting it (Anthropic's 5m default) when unset", async () => {
    const transport = new StubTransport(async () => textMessage("hello"));
    const client = new ClaudeClient({ transport });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], cache: true });
    expect(transport.sendCalls[0]!.cache_control).toEqual({ type: "ephemeral" });

    await client.sendMessage({ messages: [{ role: "user", content: "hi" }], cache: true, cacheTtl: "1h" });
    expect(transport.sendCalls[1]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let attempts = 0;
    const transport = new StubTransport(async () => {
      attempts++;
      if (attempts < 3) throw rateLimitError();
      return textMessage("ok");
    });
    const sleeps: number[] = [];
    const client = new ClaudeClient({
      transport,
      retry: { sleep: async (ms) => void sleeps.push(ms), jitter: () => 1, baseDelayMs: 100, maxDelayMs: 10000 },
    });

    const message = await client.sendMessage({ messages: [{ role: "user", content: "hi" }] });

    expect(message.content[0]).toMatchObject({ text: "ok" });
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const transport = new StubTransport(async () => {
      throw rateLimitError();
    });
    const client = new ClaudeClient({
      transport,
      retry: { maxRetries: 2, sleep: async () => undefined, jitter: () => 0 },
    });

    await expect(client.sendMessage({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      APIError,
    );
    // 1 initial attempt + 2 retries = 3 calls
    expect(transport.sendCalls).toHaveLength(3);
  });

  it("does not retry a non-retryable (400) error", async () => {
    const transport = new StubTransport(async () => {
      throw badRequestError();
    });
    const client = new ClaudeClient({ transport, retry: { sleep: async () => undefined } });

    await expect(client.sendMessage({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      APIError,
    );
    expect(transport.sendCalls).toHaveLength(1);
  });
});

describe("ClaudeClient.structured", () => {
  const FactSchema = z.object({
    fact: z.string(),
    confidence: z.number(),
  });

  it("forces the named tool, validates, and returns parsed data", async () => {
    const transport = new StubTransport(async (req) => {
      expect(req.tool_choice).toEqual({ type: "tool", name: "extract_fact" });
      expect(req.tools?.[0]?.name).toBe("extract_fact");
      return toolUseMessage("extract_fact", { fact: "Mojo is a puppy.", confidence: 0.9 });
    });
    const client = new ClaudeClient({ transport });

    const result = await client.structured({
      messages: [{ role: "user", content: "Mojo is a puppy." }],
      tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
    });

    expect(result.data).toEqual({ fact: "Mojo is a puppy.", confidence: 0.9 });
  });

  it("throws StructuredOutputError when the tool isn't called", async () => {
    const transport = new StubTransport(async () => textMessage("I don't want to."));
    const client = new ClaudeClient({ transport });

    await expect(
      client.structured({
        messages: [{ role: "user", content: "x" }],
        tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
      }),
    ).rejects.toThrow(StructuredOutputError);
  });

  it("throws StructuredOutputError when the tool input fails schema validation", async () => {
    const transport = new StubTransport(async () => toolUseMessage("extract_fact", { fact: 123 }));
    const client = new ClaudeClient({ transport });

    await expect(
      client.structured({
        messages: [{ role: "user", content: "x" }],
        tool: { name: "extract_fact", description: "extract one fact", schema: FactSchema },
      }),
    ).rejects.toThrow(StructuredOutputError);
  });
});

describe("ClaudeClient.streamMessage", () => {
  it("yields text chunks and resolves `final` with usage recorded", async () => {
    const finalMsg = textMessage("hello world");
    const events: Anthropic.MessageStreamEvent[] = [
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello " } } as never,
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "ignored" } } as never,
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } } as never,
    ];

    class StreamTransport implements ClaudeTransport {
      send(): Promise<Anthropic.Message> {
        throw new Error("unused");
      }
      stream(): ClaudeMessageStream {
        return {
          [Symbol.asyncIterator]: () => {
            let i = 0;
            return {
              next: async () => (i < events.length ? { done: false, value: events[i++]! } : { done: true, value: undefined }),
            };
          },
          finalMessage: async () => finalMsg,
        };
      }
    }

    const client = new ClaudeClient({ transport: new StreamTransport() });
    const handle = client.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    const collected: string[] = [];
    for await (const chunk of handle.chunks) {
      if (chunk.type === "text") collected.push(chunk.text);
    }
    const final = await handle.final;

    expect(collected.join("")).toBe("hello world");
    expect(final).toBe(finalMsg);
    expect(client.costTracker.history()).toHaveLength(1);
  });

  it("resolves `final` even when the caller never iterates `chunks`", async () => {
    // Regression: `final` must not depend on something else driving the
    // `chunks` async generator — it used to hang forever in this case,
    // since `async function*` bodies are lazy until first iterated.
    const finalMsg = textMessage("done");
    class StreamTransport implements ClaudeTransport {
      send(): Promise<Anthropic.Message> {
        throw new Error("unused");
      }
      stream(): ClaudeMessageStream {
        return {
          [Symbol.asyncIterator]: () => {
            let yielded = false;
            return {
              next: async () => {
                if (yielded) return { done: true, value: undefined };
                yielded = true;
                return {
                  done: false,
                  value: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } } as never,
                };
              },
            };
          },
          finalMessage: async () => finalMsg,
        };
      }
    }

    const client = new ClaudeClient({ transport: new StreamTransport() });
    const handle = client.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    // Never touch handle.chunks.
    const final = await handle.final;
    expect(final).toBe(finalMsg);
  });

  it("still delivers every chunk to a consumer that starts draining `chunks` after `final` has already resolved", async () => {
    const finalMsg = textMessage("ab");
    const events: Anthropic.MessageStreamEvent[] = [
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "a" } } as never,
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "b" } } as never,
    ];
    class StreamTransport implements ClaudeTransport {
      send(): Promise<Anthropic.Message> {
        throw new Error("unused");
      }
      stream(): ClaudeMessageStream {
        return {
          [Symbol.asyncIterator]: () => {
            let i = 0;
            return {
              next: async () => (i < events.length ? { done: false, value: events[i++]! } : { done: true, value: undefined }),
            };
          },
          finalMessage: async () => finalMsg,
        };
      }
    }

    const client = new ClaudeClient({ transport: new StreamTransport() });
    const handle = client.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    await handle.final;
    const collected: string[] = [];
    for await (const chunk of handle.chunks) {
      if (chunk.type === "text") collected.push(chunk.text);
    }
    expect(collected.join("")).toBe("ab");
  });

  it("propagates a transport error through both `chunks` iteration and `final`", async () => {
    const boom = new Error("stream exploded");
    class FailingTransport implements ClaudeTransport {
      send(): Promise<Anthropic.Message> {
        throw new Error("unused");
      }
      stream(): ClaudeMessageStream {
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

    const client = new ClaudeClient({ transport: new FailingTransport() });
    const handle = client.streamMessage({ messages: [{ role: "user", content: "hi" }] });

    await expect(handle.final).rejects.toThrow(boom);
    await expect((async () => {
      for await (const _chunk of handle.chunks) {
        // drain
      }
    })()).rejects.toThrow(boom);
  });
});

describe("ClaudeClient construction", () => {
  it("throws when neither apiKey nor transport is given", () => {
    expect(() => new ClaudeClient({})).toThrow();
  });

  it("accepts an apiKey and builds a RealTransport without making a call", () => {
    expect(() => new ClaudeClient({ apiKey: "sk-test" })).not.toThrow();
  });
});
