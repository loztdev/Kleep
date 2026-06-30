/**
 * StubReflector — deterministic contradiction/corroboration detector
 * used by tests and as a fallback when no LLM Reflector is configured.
 *
 * Heuristics intentionally narrow:
 *
 *   - Two opinions on the same entity that look like negations of each
 *     other → contradiction. "Negation" here means one contains a
 *     " not " or " isn't " or " never " token the other lacks, while
 *     sharing all other significant tokens.
 *   - An opinion whose content exactly matches (normalized) a stored
 *     fact → corroboration.
 *
 * Real production reflection is much smarter — but the architecture
 * doesn't change. Drop in a Claude-backed Reflector behind the same
 * interface.
 */

import type { MemoryAsset } from "../schema";
import { tokenize } from "../retrieval/tokenize";
import type {
  Reflector,
  ReflectionFinding,
  ReflectionInput,
} from "./types";

const NEGATORS = new Set(["not", "isn't", "doesn't", "never", "no", "wasn't"]);

export class StubReflector implements Reflector {
  reflect(input: ReflectionInput): readonly ReflectionFinding[] {
    const out: ReflectionFinding[] = [];
    out.push(...this.findContradictoryOpinions(input.opinions));
    out.push(...this.findCorroborations(input.opinions, input.facts));
    return out;
  }

  private findContradictoryOpinions(
    opinions: readonly MemoryAsset[],
  ): ReflectionFinding[] {
    const findings: ReflectionFinding[] = [];
    for (let i = 0; i < opinions.length; i++) {
      for (let j = i + 1; j < opinions.length; j++) {
        const a = opinions[i]!;
        const b = opinions[j]!;
        if (!sharesAnyEntity(a, b)) continue;
        if (a.viewpoint_holder === b.viewpoint_holder) continue;
        if (!looksLikeNegation(a.content, b.content)) continue;
        findings.push({
          kind: "contradiction",
          primary_asset_id: a.id,
          supporting_asset_ids: [b.id],
          rationale: `${a.viewpoint_holder ?? "?"} and ${
            b.viewpoint_holder ?? "?"
          } disagree on the same claim.`,
          confidence: 0.6,
          effect: { type: "adjust_confidence", delta: -0.1 },
        });
      }
    }
    return findings;
  }

  private findCorroborations(
    opinions: readonly MemoryAsset[],
    facts: readonly MemoryAsset[],
  ): ReflectionFinding[] {
    const findings: ReflectionFinding[] = [];
    const factByContent = new Map<string, MemoryAsset>();
    for (const f of facts) {
      factByContent.set(normalize(f.content), f);
    }
    for (const op of opinions) {
      const match = factByContent.get(normalize(op.content));
      if (!match) continue;
      findings.push({
        kind: "corroboration",
        primary_asset_id: op.id,
        supporting_asset_ids: [match.id],
        rationale: `Opinion confirmed by recorded fact.`,
        confidence: 0.75,
        effect: { type: "adjust_confidence", delta: +0.1 },
      });
    }
    return findings;
  }
}

/**
 * Determines whether two assets reference at least one common entity or overlapping content token.
 *
 * @param a - The first asset to compare
 * @param b - The second asset to compare
 * @returns `true` if the assets share an entity ID or, when either asset has no entity IDs, share a token in their content; `false` otherwise
 */
function sharesAnyEntity(a: MemoryAsset, b: MemoryAsset): boolean {
  if (a.entity_ids.length === 0 || b.entity_ids.length === 0) {
    // No entity refs — fall back to overlapping content tokens.
    const at = new Set(tokenize(a.content));
    for (const t of tokenize(b.content)) if (at.has(t)) return true;
    return false;
  }
  const set = new Set(a.entity_ids);
  for (const e of b.entity_ids) if (set.has(e)) return true;
  return false;
}

/**
 * Determines whether two texts express opposing negation.
 *
 * @param a - The first text to compare
 * @param b - The second text to compare
 * @returns `true` if one text contains a negation cue and the other does not, and their remaining content is closely similar; `false` otherwise.
 */
function looksLikeNegation(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const an = ta.some((t) => NEGATORS.has(t));
  const bn = tb.some((t) => NEGATORS.has(t));
  if (an === bn) return false; // both negated or neither = not opposing
  // Strip negators and require strong content overlap.
  const stripA = ta.filter((t) => !NEGATORS.has(t));
  const stripB = tb.filter((t) => !NEGATORS.has(t));
  return jaccard(stripA, stripB) >= 0.6;
}

/**
 * Computes the Jaccard similarity between two token arrays.
 *
 * @param a - The first token array.
 * @param b - The second token array.
 * @returns The Jaccard similarity score, or `0` when both arrays are empty.
 */
function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Normalizes whitespace and letter casing in a string.
 *
 * @param s - The input string
 * @returns The trimmed, lowercase string with internal whitespace collapsed to single spaces
 */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
