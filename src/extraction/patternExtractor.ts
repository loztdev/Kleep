/**
 * PatternExtractor — deterministic, regex-based extractor used by the
 * Tier 2 test harness.
 *
 * Real production extraction will call an LLM (Claude) with a
 * structured-output schema. This stub exists so the engine and
 * reconciler can be exercised without a network call.
 *
 * Patterns supported (rough):
 *
 * - `"<Name> is a <type>."`  → ENTITY in OBSERVATION network
 * - `"<Name> is at <Place>."` → FACT in EXPERIENCE network
 * - `"<Name> has <thing>."`  → FACT in OBSERVATION network
 * - `"<Name> thinks <claim>."` / `"<Name> believes <claim>."`
 *                              → OPINION in OPINION network with
 *                                viewpoint_holder=<Name>
 *
 * Patterns are intentionally narrow. Anything ambiguous is ignored;
 * the reconciler tests separately for what happens when the same fact
 * arrives twice.
 */

import { MemoryKind, Network } from "../schema";
import type { Turn } from "../conversation";
import type {
  ExtractedAtomicFact,
  ExtractedEntity,
  ExtractedFact,
  Extractor,
} from "./types";

const NAME = "[A-Z][\\w'-]*";

const PATTERNS = {
  entity: new RegExp(`\\b(${NAME}) is a ([a-z][\\w ]*?)\\.`, "g"),
  location: new RegExp(`\\b(${NAME}) is at (${NAME})\\.`, "g"),
  possession: new RegExp(`\\b(${NAME}) has (?:a |an |the )?([a-z][\\w ]*?)\\.`, "g"),
  opinion: new RegExp(`\\b(${NAME}) (?:thinks|believes) (.+?)\\.`, "g"),
} as const;

export interface PatternExtractorOptions {
  /** Confidence assigned to every match. Defaults to 0.7. */
  confidence?: number;
}

export class PatternExtractor implements Extractor {
  private readonly confidence: number;

  constructor(opts: PatternExtractorOptions = {}) {
    this.confidence = opts.confidence ?? 0.7;
  }

  extract(turn: Turn): readonly ExtractedFact[] {
    const out: ExtractedFact[] = [];
    for (const m of matches(turn.content, PATTERNS.entity)) {
      const [, name, kindWord] = m;
      out.push(this.entity(name!, kindWord!, m[0]!));
    }
    for (const m of matches(turn.content, PATTERNS.location)) {
      const [, name, place] = m;
      out.push(
        this.atomic({
          kind: MemoryKind.FACT,
          network: Network.EXPERIENCE,
          content: `${name} is at ${place}.`,
          quote: m[0]!,
          entity_ids: [name!, place!],
        }),
      );
    }
    for (const m of matches(turn.content, PATTERNS.possession)) {
      const [, name, thing] = m;
      out.push(
        this.atomic({
          kind: MemoryKind.FACT,
          network: Network.OBSERVATION,
          content: `${name} has ${thing}.`,
          quote: m[0]!,
          entity_ids: [name!],
        }),
      );
    }
    for (const m of matches(turn.content, PATTERNS.opinion)) {
      const [, name, claim] = m;
      out.push(
        this.atomic({
          kind: MemoryKind.OPINION,
          network: Network.OPINION,
          content: `${name} ${claimVerb(m[0]!)} ${claim}.`,
          quote: m[0]!,
          viewpoint_holder: name!,
        }),
      );
    }
    return out;
  }

  private entity(name: string, kindWord: string, quote: string): ExtractedEntity {
    return {
      type: "entity",
      entity_id: `char:${name.toLowerCase()}`,
      entity_type: kindWord.trim(),
      canonical_name: name,
      network: Network.OBSERVATION,
      content: `${name} is a ${kindWord}.`,
      quote,
      confidence: this.confidence,
      attributes: [
        {
          key: "type",
          value: kindWord.trim(),
          quote,
          confidence: this.confidence,
        },
      ],
    };
  }

  private atomic(
    spec: Omit<ExtractedAtomicFact, "type" | "confidence">,
  ): ExtractedAtomicFact {
    return { type: "atomic", confidence: this.confidence, ...spec };
  }
}

function* matches(s: string, re: RegExp): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

function claimVerb(matched: string): string {
  return matched.includes(" believes ") ? "believes" : "thinks";
}
