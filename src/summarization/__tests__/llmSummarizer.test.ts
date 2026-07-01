import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeClient } from "../../claude";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "../../claude";
import { ClaudeProvider, type LlmProvider } from "../../llm";
import { ConversationBuffer, TurnRole, type Turn } from "../../conversation";
import { InMemoryStructuredStore, InMemoryVectorStore } from "../../storage";
import { MemoryRouter } from "../../router";
import { RouterSink } from "../../ingest";
import { RollingSummarizer } from "../rollingSummarizer";
import { LlmSummarizer } from "../llmSummarizer";
import { StubSummarizer } from "../stubSummarizer";

function turn(id: string, content: string, index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

class ScriptedTransport implements ClaudeTransport {
  public calls: ClaudeRequest[] = [];
  constructor(private readonly script: (req: ClaudeRequest) => Anthropic.Message) {}

  async send(req: ClaudeRequest): Promise<Anthropic.Message> {
    this.calls.push(req);
    return this.script(req);
  }

  stream(): ClaudeMessageStream {
    throw new Error("not used");
  }
}

function textReply(text: string): Anthropic.Message {
  return {
    id: "msg_summary",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 150,
      output_tokens: 40,
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

/** Wrap a scripted transport in a real ClaudeClient behind the generic ClaudeProvider adapter. */
function providerFor(transport: ClaudeTransport): LlmProvider {
  return new ClaudeProvider(new ClaudeClient({ transport }));
}

const SAMPLE_TURNS: Turn[] = [
  turn("t1", "Mojo finds a rusty key in the basement.", 0),
  turn("t2", "Alice gives the key to Mojo and they head to the gate.", 1),
];

describe("LlmSummarizer", () => {
  it("returns the model's text when it validates (mentions an entity, under the word cap)", async () => {
    const transport = new ScriptedTransport(() =>
      textReply("Mojo found a rusty key in the basement and Alice gave it to him before they headed to the gate."),
    );
    const summarizer = new LlmSummarizer({ client: providerFor(transport) });

    const delta = await summarizer.summarize(SAMPLE_TURNS);

    expect(delta).toContain("Mojo");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.system).toContain("state-delta");
  });

  it("falls back to StubSummarizer when the underlying call throws", async () => {
    const transport: ClaudeTransport = {
      send: async () => {
        throw new Error("network down");
      },
      stream: () => {
        throw new Error("not used");
      },
    };
    const client = new ClaudeProvider(new ClaudeClient({ transport, retry: { maxRetries: 0 } }));
    const fallback = new StubSummarizer();
    const summarizer = new LlmSummarizer({ client, fallback });

    const delta = await summarizer.summarize(SAMPLE_TURNS);

    expect(delta).toBe(fallback.summarize(SAMPLE_TURNS));
  });

  it("falls back when the model's output exceeds the word cap", async () => {
    const longText = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const transport = new ScriptedTransport(() => textReply(longText));
    const fallback = new StubSummarizer();
    const summarizer = new LlmSummarizer({ client: providerFor(transport), fallback, maxWords: 10 });

    const delta = await summarizer.summarize(SAMPLE_TURNS);

    expect(delta).toBe(fallback.summarize(SAMPLE_TURNS));
  });

  it("falls back when the model's output doesn't mention any name present in the source turns", async () => {
    const transport = new ScriptedTransport(() => textReply("Something happened, vaguely."));
    const fallback = new StubSummarizer();
    const summarizer = new LlmSummarizer({ client: providerFor(transport), fallback });

    const delta = await summarizer.summarize(SAMPLE_TURNS);

    expect(delta).toBe(fallback.summarize(SAMPLE_TURNS));
  });

  it("handles an empty turn window without calling the model", async () => {
    const transport = new ScriptedTransport(() => textReply("unused"));
    const summarizer = new LlmSummarizer({ client: providerFor(transport) });

    await summarizer.summarize([]);

    expect(transport.calls).toHaveLength(0);
  });

  it("plugs into RollingSummarizer and produces a SUMMARY asset from real conversation turns", async () => {
    const transport = new ScriptedTransport(() =>
      textReply("Mojo picked up a rusty key from Alice before they both moved toward the gate."),
    );
    const summarizer = new LlmSummarizer({ client: providerFor(transport) });

    const buffer = new ConversationBuffer();
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    const sink = new RouterSink(router);
    const rolling = new RollingSummarizer(buffer, summarizer, sink, { threshold: 1, windowSize: 2 });

    for (const t of SAMPLE_TURNS) buffer.append(t);

    const result = await rolling.tick();

    expect(result.summariesProduced).toBe(1);
    expect(result.outcomes[0]!.asset.content).toContain("Mojo");
    expect(structured.size()).toBe(1);
  });
});
