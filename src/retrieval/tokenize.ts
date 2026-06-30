/**
 * Cheap tokenizer for the BM25 index and entity-mention extractor.
 *
 * Lowercases, splits on non-word characters, filters empties.
 * Deliberately no stemming / stop-words — Tier 3.6 stays under 100 LoC
 * by leaning on the fusion stage to fix per-channel weaknesses. If
 * recall quality degrades on a real workload we can add a Snowball
 * stemmer here without touching anything downstream.
 */

const SPLIT = /[^a-z0-9']+/i;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(SPLIT)) {
    if (raw.length > 0) out.push(raw);
  }
  return out;
}
