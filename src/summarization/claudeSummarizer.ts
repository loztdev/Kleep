/**
 * Tier 5.3 — ClaudeSummarizer.
 *
 * Replaces `StubSummarizer`'s placeholder string with a real "state
 * delta" prompt: given a window of turns, produce one paragraph of what
 * changed (inventory, locations, relationships). Output is validated
 * (length cap, must reference at least one capitalized name pulled from
 * the source turns when one exists) before being accepted; on either an
 * API failure or a validation miss, this falls back to `StubSummarizer`
 * so `RollingSummarizer.tick()` never blocks on a flaky call.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient } from "../claude";
import type { Turn } from "../conversation";
import { StubSummarizer } from "./stubSummarizer";
import type { Summarizer } from "./types";

const DEFAULT_MAX_WORDS = 120;

/** Construction options for `ClaudeSummarizer`. */
export interface ClaudeSummarizerOptions {
  client: ClaudeClient;
  /** Overrides the client's default model for summarization calls. */
  model?: string;
  /** `max_tokens` for the summarization call. Default 400. */
  maxTokens?: number;
  /** Word-count cap enforced on the returned delta. Default 120. */
  maxWords?: number;
  /** Used when the Claude call fails or its output doesn't validate. Defaults to a fresh `StubSummarizer`. */
  fallback?: Summarizer;
}

/** Claude-backed `Summarizer` — real state-delta prompt with a stub fallback on failure. */
export class ClaudeSummarizer implements Summarizer {
  private readonly maxWords: number;
  private readonly fallback: Summarizer;

  constructor(private readonly opts: ClaudeSummarizerOptions) {
    this.maxWords = opts.maxWords ?? DEFAULT_MAX_WORDS;
    this.fallback = opts.fallback ?? new StubSummarizer();
  }

  async summarize(turns: readonly Turn[]): Promise<string> {
    if (turns.length === 0) return Promise.resolve(this.fallback.summarize(turns));

    try {
      const message = await this.opts.client.sendMessage({
        ...(this.opts.model !== undefined ? { model: this.opts.model } : {}),
        maxTokens: this.opts.maxTokens ?? 400,
        system: systemPrompt(this.maxWords),
        messages: [{ role: "user", content: turnsPrompt(turns) }],
      });
      const text = extractText(message);
      if (isValidSummary(text, turns, this.maxWords)) return text;
      return Promise.resolve(this.fallback.summarize(turns));
    } catch {
      return Promise.resolve(this.fallback.summarize(turns));
    }
  }
}

function systemPrompt(maxWords: number): string {
  return `You write rolling state-delta summaries for Kleep, a narrative memory system.

Given a window of conversation turns, produce ONE paragraph capturing what changed: inventory, locations, relationships, and other persistent state. Name entities explicitly by name rather than with pronouns. Summarize the resulting state — do not just repeat the dialogue. Keep it under ${maxWords} words. Respond with the paragraph only: no preamble, no headers, no surrounding quotes.`;
}

function turnsPrompt(turns: readonly Turn[]): string {
  const lines = turns.map((t) => `[${t.id}] ${t.role}: ${t.content}`);
  return `Turns:\n${lines.join("\n")}`;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Length cap plus a "mentions a real name" grounding check (skipped when the source has no capitalized names to check against). */
function isValidSummary(text: string, turns: readonly Turn[], maxWords: number): boolean {
  if (text.length === 0) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > maxWords) return false;

  const candidates = capitalizedTokens(turns);
  if (candidates.size === 0) return true;
  for (const name of candidates) {
    if (text.includes(name)) return true;
  }
  return false;
}

/** Every capitalized word across `turns` — a cheap proxy for "named entity" with no NLP dependency. */
function capitalizedTokens(turns: readonly Turn[]): Set<string> {
  const tokens = new Set<string>();
  for (const turn of turns) {
    for (const match of turn.content.matchAll(/\b[A-Z][a-zA-Z'-]*\b/g)) {
      tokens.add(match[0]);
    }
  }
  return tokens;
}
