/**
 * StubSummarizer — deterministic summary string for tests.
 *
 * Real production summarization will call an LLM with a structured
 * "give me the state delta over these turns" prompt. The interface is
 * the same.
 */

import type { Turn } from "../conversation";
import type { Summarizer } from "./types";

/** Deterministic test summarizer — emits `[firstId..lastId] N turns: ...`. */
export class StubSummarizer implements Summarizer {
  /** Render `[firstId..lastId] N turns: word1, word2, ...` from the window. */
  summarize(turns: readonly Turn[]): string {
    if (turns.length === 0) return "[empty window]";
    const firstId = turns[0]!.id;
    const lastId = turns[turns.length - 1]!.id;
    const heads = turns
      .map((t) => firstWord(t.content))
      .filter((w) => w.length > 0);
    return `[${firstId}..${lastId}] ${turns.length} turn${
      turns.length === 1 ? "" : "s"
    }: ${heads.join(", ")}`;
  }
}

/** Pull the first word-shaped token from a string (or empty for none). */
function firstWord(s: string): string {
  const m = s.trim().match(/^[\w']+/);
  return m ? m[0] : "";
}
