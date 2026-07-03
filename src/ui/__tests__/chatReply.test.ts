import type { LlmProvider, LlmSendOptions, LlmStreamHandle, LlmStructuredOptions, LlmStructuredResult, LlmTextResult } from "../../llm";
import { TurnRole, type Turn } from "../../conversation";
import { generateReply } from "../chatReply";

class StubProvider implements LlmProvider {
  readonly name = "stub";
  calls: LlmSendOptions[] = [];

  totalCostUsd(): number {
    return 0;
  }

  async sendMessage(opts: LlmSendOptions): Promise<LlmTextResult> {
    this.calls.push(opts);
    return { text: "reply", model: "stub-model", usage: { inputTokens: 1, outputTokens: 1 } };
  }

  async structured<T>(_opts: LlmStructuredOptions<T>): Promise<LlmStructuredResult<T>> {
    throw new Error("not used");
  }

  streamMessage(_opts: LlmSendOptions): LlmStreamHandle {
    throw new Error("not used");
  }
}

function turn(role: (typeof TurnRole)[keyof typeof TurnRole], content: string, index: number): Turn {
  return { id: `t${index}` as Turn["id"], role, content, index };
}

describe("generateReply", () => {
  it("requests caching on every call, since `messages` grows every turn", async () => {
    const provider = new StubProvider();
    const turns = [turn(TurnRole.USER, "hi", 0)];

    const reply = await generateReply(provider, turns);

    expect(reply).toBe("reply");
    expect(provider.calls[0]!.cache).toBe(true);
  });
});
