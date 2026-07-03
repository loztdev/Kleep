import type Anthropic from "@anthropic-ai/sdk";
import { CostTracker } from "../costTracker";

function usage(overrides: Partial<Anthropic.Usage> = {}): Anthropic.Usage {
  return {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    ...overrides,
  };
}

describe("CostTracker", () => {
  it("computes cost from default pricing", () => {
    const tracker = new CostTracker();
    const entry = tracker.record("claude-opus-4-8", usage());
    // 1000 input @ $5/MTok + 500 output @ $25/MTok
    expect(entry.costUsd).toBeCloseTo((1000 * 5 + 500 * 25) / 1_000_000);
  });

  it("records cache token fields", () => {
    const tracker = new CostTracker();
    const entry = tracker.record(
      "claude-sonnet-5",
      usage({ cache_read_input_tokens: 200, cache_creation_input_tokens: 50 }),
    );
    expect(entry.cacheReadInputTokens).toBe(200);
    expect(entry.cacheCreationInputTokens).toBe(50);
  });

  it("prices cache writes at 1.25x and cache reads at 0.1x the base input rate", () => {
    const tracker = new CostTracker();
    const entry = tracker.record(
      "claude-opus-4-8",
      usage({
        input_tokens: 10,
        output_tokens: 0,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000,
      }),
    );
    // 10 uncached input @ $5/MTok + 1000 cache-write @ $5*1.25/MTok + 2000 cache-read @ $5*0.1/MTok
    const expected = (10 * 5 + 1000 * 5 * 1.25 + 2000 * 5 * 0.1) / 1_000_000;
    expect(entry.costUsd).toBeCloseTo(expected);
  });

  it("accumulates history and a running total", () => {
    const tracker = new CostTracker();
    tracker.record("claude-haiku-4-5", usage());
    tracker.record("claude-haiku-4-5", usage());
    expect(tracker.history()).toHaveLength(2);
    expect(tracker.totalUsd()).toBeCloseTo(2 * ((1000 * 1 + 500 * 5) / 1_000_000));
  });

  it("returns zero cost (without throwing) for an unknown model", () => {
    const tracker = new CostTracker();
    const entry = tracker.record("some-future-model", usage());
    expect(entry.costUsd).toBe(0);
    expect(entry.inputTokens).toBe(1000);
  });

  it("honors a custom pricing table", () => {
    const tracker = new CostTracker({ "custom-model": { inputPerMTok: 1, outputPerMTok: 2 } });
    const entry = tracker.record("custom-model", usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }));
    expect(entry.costUsd).toBe(3);
  });
});
