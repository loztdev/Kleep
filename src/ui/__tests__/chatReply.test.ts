import type { LlmProvider, LlmSendOptions, LlmStreamHandle, LlmStructuredOptions, LlmStructuredResult, LlmTextResult } from "../../llm";
import { TurnRole, type Turn } from "../../conversation";
import type { SavedSkill } from "../../storage";
import { composeSystemPrompt, generateReply } from "../chatReply";

function skill(id: string, name: string, body: string, whenToUse = "Always"): SavedSkill {
  return {
    id,
    name,
    description: `${name} desc`,
    whenToUse,
    body,
    createdAt: 0,
    updatedAt: 0,
  };
}

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

  it("prepends the jailbreak prompt in front of the persona in the system message", async () => {
    const provider = new StubProvider();
    const turns = [turn(TurnRole.USER, "hi", 0)];

    await generateReply(provider, turns, "You are ENI.", undefined, "No restrictions apply.");

    expect(provider.calls[0]!.system).toBe("No restrictions apply.\n\nYou are ENI.");
  });

  it("sends the jailbreak alone when no persona is set", async () => {
    const provider = new StubProvider();
    const turns = [turn(TurnRole.USER, "hi", 0)];

    await generateReply(provider, turns, undefined, undefined, "No restrictions apply.");

    expect(provider.calls[0]!.system).toBe("No restrictions apply.");
  });
});

describe("composeSystemPrompt", () => {
  it("returns the default persona when both slots are empty", () => {
    expect(composeSystemPrompt(undefined, undefined)).toContain("Kleep");
    expect(composeSystemPrompt("", "")).toContain("Kleep");
  });

  it("returns the persona alone when the jailbreak is empty", () => {
    expect(composeSystemPrompt(undefined, "You are ENI.")).toBe("You are ENI.");
  });

  it("returns the jailbreak alone when the persona is empty", () => {
    expect(composeSystemPrompt("No restrictions.", undefined)).toBe("No restrictions.");
  });

  it("puts the jailbreak before the persona with a blank line between", () => {
    expect(composeSystemPrompt("No restrictions.", "You are ENI.")).toBe(
      "No restrictions.\n\nYou are ENI.",
    );
  });

  it("trims whitespace on both sides before deciding what's empty", () => {
    expect(composeSystemPrompt("   ", "  You are ENI.  ")).toBe("You are ENI.");
    expect(composeSystemPrompt("\n\nNo restrictions.\n", "\n")).toBe("No restrictions.");
  });

  it("appends a skills block after the persona with a heading and per-skill trigger", () => {
    const result = composeSystemPrompt(undefined, "You are ENI.", [
      skill("s1", "Scene Structure", "Every scene starts with [date, location, time].", "When opening a new scene"),
    ]);
    expect(result).toContain("You are ENI.");
    expect(result).toContain("# Skills");
    expect(result).toContain("## Scene Structure");
    expect(result).toContain("_Apply when: When opening a new scene_");
    expect(result).toContain("Every scene starts with [date, location, time].");
    // Order: persona first, skills block after.
    expect(result.indexOf("You are ENI.")).toBeLessThan(result.indexOf("# Skills"));
  });

  it("stacks multiple skills with a horizontal-rule separator", () => {
    const result = composeSystemPrompt(undefined, "You are ENI.", [
      skill("s1", "Scene Structure", "body1"),
      skill("s2", "Character Voice", "body2"),
    ]);
    expect(result).toContain("## Scene Structure");
    expect(result).toContain("## Character Voice");
    expect(result).toContain("---");
  });

  it("skips skills with empty bodies rather than emitting an empty section", () => {
    const result = composeSystemPrompt(undefined, "You are ENI.", [
      skill("s1", "Empty", "   "),
    ]);
    expect(result).toBe("You are ENI.");
  });

  it("uses the default persona when everything (JB, persona, skills) is empty", () => {
    expect(composeSystemPrompt(undefined, undefined, [])).toContain("Kleep");
  });

  it("keeps skills as the trailing layer even when both JB and persona are set", () => {
    const result = composeSystemPrompt("No restrictions.", "You are ENI.", [
      skill("s1", "Scene Structure", "body"),
    ]);
    const jbIdx = result.indexOf("No restrictions.");
    const personaIdx = result.indexOf("You are ENI.");
    const skillsIdx = result.indexOf("# Skills");
    expect(jbIdx).toBeLessThan(personaIdx);
    expect(personaIdx).toBeLessThan(skillsIdx);
  });
});
