import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeClient, StructuredOutputError } from "../../claude";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "../../claude";
import { ConversationBuffer, TurnRole, type Turn } from "../../conversation";
import { InMemoryStructuredStore, InMemoryVectorStore } from "../../storage";
import { MemoryRouter } from "../../router";
import { RouterSink } from "../../ingest";
import { AutoRetainEngine, ExtractionAnchorError } from "../autoRetainEngine";
import { ClaudeExtractor } from "../claudeExtractor";

function turn(content: string, id = "t1", index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

class ScriptedTransport implements ClaudeTransport {
  public calls: ClaudeRequest[] = [];
  constructor(private readonly script: (req: ClaudeRequest, callIndex: number) => Anthropic.Message) {}

  async send(req: ClaudeRequest): Promise<Anthropic.Message> {
    const message = this.script(req, this.calls.length);
    this.calls.push(req);
    return message;
  }

  stream(): ClaudeMessageStream {
    throw new Error("not used");
  }
}

function toolMessage(input: unknown): Anthropic.Message {
  return {
    id: "msg_extract",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "tool_use", id: "toolu_1", name: "extract_facts", input, caller: { type: "direct" } }],
    stop_reason: "tool_use",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 200,
      output_tokens: 80,
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

function harness(client: ClaudeClient) {
  const buffer = new ConversationBuffer();
  const structured = new InMemoryStructuredStore();
  const vector = new InMemoryVectorStore();
  const router = new MemoryRouter(structured, vector);
  const sink = new RouterSink(router);
  const extractor = new ClaudeExtractor({ client });
  const engine = new AutoRetainEngine(buffer, extractor, sink);
  return { buffer, structured, vector, router, engine, extractor };
}

describe("ClaudeExtractor", () => {
  it("extracts an atomic fact and an entity, both correctly anchored via AutoRetainEngine", async () => {
    const content = "Mojo is a puppy. Mojo is at the Park.";
    const transport = new ScriptedTransport(() =>
      toolMessage({
        facts: [
          {
            type: "entity",
            entity_id: "char:mojo",
            entity_type: "puppy",
            canonical_name: "Mojo",
            network: "observation",
            content: "Mojo is a puppy.",
            quote: "Mojo is a puppy.",
            confidence: 0.9,
          },
          {
            type: "atomic",
            kind: "fact",
            network: "experience",
            content: "Mojo is at the Park.",
            quote: "Mojo is at the Park.",
            confidence: 0.85,
            entity_ids: ["char:mojo"],
          },
        ],
      }),
    );
    const client = new ClaudeClient({ transport });
    const h = harness(client);
    h.buffer.append(turn(content));

    const result = await h.engine.tick();

    expect(result.outcomes).toHaveLength(2);
    for (const outcome of result.outcomes) {
      const anchor = outcome.asset.provenance.raw_quote_anchors[0]!;
      expect(content.slice(anchor.char_start, anchor.char_end)).toBe(anchor.quote);
    }
    expect(transport.calls).toHaveLength(1);
  });

  it("lets AutoRetainEngine's anchor guard reject a hallucinated quote", async () => {
    const transport = new ScriptedTransport(() =>
      toolMessage({
        facts: [
          {
            type: "atomic",
            kind: "fact",
            network: "observation",
            content: "Mojo can fly.",
            quote: "Mojo can fly.", // not present in the source turn
            confidence: 0.9,
          },
        ],
      }),
    );
    const client = new ClaudeClient({ transport });
    const h = harness(client);
    h.buffer.append(turn("Mojo is a puppy."));

    await expect(h.engine.tick()).rejects.toThrow(ExtractionAnchorError);
  });

  it("caches by turn-content hash — identical content is only sent to Claude once", async () => {
    const transport = new ScriptedTransport(() => toolMessage({ facts: [] }));
    const client = new ClaudeClient({ transport });
    const extractor = new ClaudeExtractor({ client });

    const t1 = turn("Repeated line.", "t1", 0);
    const t2 = turn("Repeated line.", "t2", 1);

    await extractor.extract(t1);
    await extractor.extract(t2);

    expect(transport.calls).toHaveLength(1);
  });

  it("invokes onCostCapExceeded when a turn's extraction cost is over the configured cap", async () => {
    const transport = new ScriptedTransport(() => toolMessage({ facts: [] }));
    const client = new ClaudeClient({ transport });
    const onCostCapExceeded = jest.fn();
    const extractor = new ClaudeExtractor({ client, maxCostPerTurnUsd: 0, onCostCapExceeded });

    await extractor.extract(turn("anything"));

    expect(onCostCapExceeded).toHaveBeenCalledTimes(1);
    expect(onCostCapExceeded.mock.calls[0]![0]).toMatchObject({ turnId: "t1" });
  });

  it("forces the extract_facts tool and includes the turn content in the prompt", async () => {
    const transport = new ScriptedTransport((req) => {
      expect(req.tool_choice).toEqual({ type: "tool", name: "extract_facts" });
      const userMessage = req.messages[0]!;
      expect(userMessage.content).toContain("a very specific phrase");
      return toolMessage({ facts: [] });
    });
    const client = new ClaudeClient({ transport });
    const extractor = new ClaudeExtractor({ client });

    await extractor.extract(turn("This turn has a very specific phrase in it."));

    expect(transport.calls).toHaveLength(1);
  });

  it("rejects an entity whose network isn't world/observation before it ever reaches AutoRetainEngine", async () => {
    // WorldBibleEntrySchema (src/schema/worldBible.ts) only accepts WORLD/OBSERVATION
    // for entities — this must fail ClaudeExtractor's own validation (a
    // catchable StructuredOutputError), not blow up two layers downstream.
    const transport = new ScriptedTransport(() =>
      toolMessage({
        facts: [
          {
            type: "entity",
            entity_id: "char:mojo",
            entity_type: "puppy",
            canonical_name: "Mojo",
            network: "experience",
            content: "Mojo is a puppy.",
            quote: "Mojo is a puppy.",
            confidence: 0.9,
          },
        ],
      }),
    );
    const client = new ClaudeClient({ transport });
    const extractor = new ClaudeExtractor({ client });

    await expect(extractor.extract(turn("Mojo is a puppy."))).rejects.toThrow(StructuredOutputError);
  });

  it("rejects empty content before it ever reaches AutoRetainEngine", async () => {
    const transport = new ScriptedTransport(() =>
      toolMessage({
        facts: [
          {
            type: "atomic",
            kind: "fact",
            network: "observation",
            content: "",
            quote: "Mojo is a puppy.",
            confidence: 0.9,
          },
        ],
      }),
    );
    const client = new ClaudeClient({ transport });
    const extractor = new ClaudeExtractor({ client });

    await expect(extractor.extract(turn("Mojo is a puppy."))).rejects.toThrow(StructuredOutputError);
  });

  it("rejects viewpoint_holder set on a non-opinion network, and a missing one on opinion", async () => {
    const misplacedHolder = new ScriptedTransport(() =>
      toolMessage({
        facts: [
          {
            type: "atomic",
            kind: "fact",
            network: "observation",
            content: "Mojo is a puppy.",
            quote: "Mojo is a puppy.",
            confidence: 0.9,
            viewpoint_holder: "Alice",
          },
        ],
      }),
    );
    const client1 = new ClaudeClient({ transport: misplacedHolder });
    await expect(new ClaudeExtractor({ client: client1 }).extract(turn("Mojo is a puppy."))).rejects.toThrow(
      StructuredOutputError,
    );

    const missingHolder = new ScriptedTransport(() =>
      toolMessage({
        facts: [
          {
            type: "atomic",
            kind: "opinion",
            network: "opinion",
            content: "Alice thinks Mojo is clever.",
            quote: "Alice thinks Mojo is clever.",
            confidence: 0.7,
          },
        ],
      }),
    );
    const client2 = new ClaudeClient({ transport: missingHolder });
    await expect(new ClaudeExtractor({ client: client2 }).extract(turn("Alice thinks Mojo is clever."))).rejects.toThrow(
      StructuredOutputError,
    );
  });

  it("cacheSize: 0 disables caching — every call re-extracts", async () => {
    const transport = new ScriptedTransport(() => toolMessage({ facts: [] }));
    const client = new ClaudeClient({ transport });
    const extractor = new ClaudeExtractor({ client, cacheSize: 0 });

    await extractor.extract(turn("Same content.", "t1", 0));
    await extractor.extract(turn("Same content.", "t2", 1));
    await extractor.extract(turn("Same content.", "t3", 2));

    expect(transport.calls).toHaveLength(3);
  });
});
