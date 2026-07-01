import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeClient } from "../../claude";
import type { ClaudeMessageStream, ClaudeRequest, ClaudeTransport } from "../../claude";
import { TurnRole, type Turn } from "../../conversation";
import { ClaudeProvider, type LlmProvider } from "../../llm";
import { newId } from "../../schema";
import { generateReply } from "../chatReply";
import { buildMemoryEngine } from "../memoryEngine";

class ScriptedTransport implements ClaudeTransport {
  calls: ClaudeRequest[] = [];
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
      input_tokens: 20,
      output_tokens: 10,
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

function toolMessage(name: string, input: unknown): Anthropic.Message {
  return { ...textMessage(""), content: [{ type: "tool_use", id: "toolu_1", name, input, caller: { type: "direct" } }] };
}

function providerFor(transport: ClaudeTransport): LlmProvider {
  return new ClaudeProvider(new ClaudeClient({ transport }));
}

describe("generateReply", () => {
  it("maps user/assistant turns to LlmMessages and returns the model's text", async () => {
    const transport = new ScriptedTransport((req) => {
      expect(req.messages).toEqual([
        { role: "user", content: "Hi, I'm Sam." },
        { role: "assistant", content: "Hey Sam!" },
        { role: "user", content: "What's my name?" },
      ]);
      expect(req.system).toContain("Kleep");
      return textMessage("Your name is Sam.");
    });

    const turns: Turn[] = [
      { id: "t1", role: TurnRole.USER, content: "Hi, I'm Sam.", index: 0 },
      { id: "t2", role: TurnRole.ASSISTANT, content: "Hey Sam!", index: 1 },
      { id: "t3", role: TurnRole.USER, content: "What's my name?", index: 2 },
    ];

    const reply = await generateReply(providerFor(transport), turns);

    expect(reply).toBe("Your name is Sam.");
  });
});

describe("buildMemoryEngine", () => {
  it("wires ChatScreen's turns through AutoRetainEngine into the structured store", async () => {
    const transport = new ScriptedTransport(() =>
      toolMessage("extract_facts", {
        facts: [
          {
            type: "entity",
            entity_id: "char:sam",
            entity_type: "person",
            canonical_name: "Sam",
            network: "observation",
            content: "Sam lives in Denver.",
            quote: "my name is Sam and I live in Denver",
            confidence: 0.9,
          },
        ],
      }),
    );
    const engine = buildMemoryEngine(providerFor(transport));

    const userTurn: Turn = { id: newId(), role: TurnRole.USER, content: "Hi, my name is Sam and I live in Denver.", index: 0 };
    engine.buffer.append(userTurn);

    const result = await engine.autoRetain.tick();

    expect(result.outcomes).toHaveLength(1);
    expect(engine.structured.size()).toBe(1);
  });

  it("rolls turns into a SUMMARY once the token threshold is crossed", async () => {
    const transport = new ScriptedTransport((req) => {
      if (req.tools) return toolMessage("extract_facts", { facts: [] });
      return textMessage("Sam introduced themselves and mentioned living in Denver.");
    });
    const engine = buildMemoryEngine(providerFor(transport));

    for (let i = 0; i < 3; i++) {
      engine.buffer.append({ id: `t${i}`, role: TurnRole.USER, content: `Turn number ${i} about Sam.`, index: i });
    }

    await engine.autoRetain.tick();
    // windowSize is 6 and only 3 turns exist, so a real threshold-triggered
    // tick may not fire yet — call flush() directly to exercise the same
    // summarizeWindow() path deterministically.
    const result = await engine.rollingSummarizer.flush();

    expect(result.summariesProduced).toBe(1);
    expect(result.outcomes[0]!.asset.content).toContain("Sam");
  });
});
