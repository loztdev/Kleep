/**
 * Tier 2.5: DedupReconciler.
 *
 * Sits between the AutoRetainEngine's output and the MemoryRouter.
 * Before any new asset hits storage, the reconciler asks:
 *
 *   1. Have we already seen this thing?
 *   2. If yes, is it identical (corroboration) or different (state change)?
 *   3. Either way, what's the right "merged" asset to store?
 *
 * Dispatch by shape:
 *
 *   - WorldBibleEntry → entity-card merge with per-attribute logic
 *     (see `attributeMerge.ts`). Aliases union, attributes folded.
 *   - LoreSnippet → written through as-is. Lore-level dedup is
 *     genuinely hard (it's prose); Tier 4.9 (CARA reflection) will
 *     compress repeated lore.
 *   - Other MemoryAsset (FACT / RULE / SUMMARY / REFLECTION / OPINION)
 *     → exact-content dedup keyed on (kind, network, entity_ids,
 *     viewpoint_holder, normalized content). On hit, relevance bumps
 *     and the new quote becomes a corroborating anchor.
 *
 * The reconciler is stateless — every lookup hits the router/store.
 * Restart-safe by construction.
 */

import {
  MemoryKind,
  type LoreSnippet,
  type MemoryAsset,
  type Network,
  type WorldBibleAttribute,
  type WorldBibleEntry,
} from "../schema";
import { MemoryRouter } from "../router";
import type {
  AnyAsset,
  IngestOutcome,
  IngestOutcomeKind,
  IngestSink,
} from "../ingest";
import {
  combineProvenance,
  mergeAttribute,
  type AttributeMergeKind,
} from "./attributeMerge";

interface AttributeChange {
  key: string;
  kind: AttributeMergeKind;
  previousValue?: unknown;
  newValue?: unknown;
}

interface EntryMergeDetails {
  changes: AttributeChange[];
  /** Aliases that were newly added by the incoming entry. */
  newAliases: string[];
}

interface AtomicBumpDetails {
  previousRelevance: number;
  newRelevance: number;
  addedAnchors: number;
}

/** Tier 2.5 — stateless dedup + state-tracking IngestSink in front of the router. */
export class DedupReconciler implements IngestSink {
  /** Wraps a router; the reconciler holds no persistent state of its own. */
  constructor(private readonly router: MemoryRouter) {}

  /**
   * Reconcile `asset` against existing storage and write the merged
   * result. Returns an outcome describing what happened (created /
   * bumped / merged / state_changed).
   */
  ingest(asset: AnyAsset): IngestOutcome {
    if (isWorldBibleEntry(asset)) return this.ingestEntry(asset);
    if (asset.kind === MemoryKind.LORE) return this.ingestLore(asset as LoreSnippet);
    return this.ingestAtomic(asset as MemoryAsset);
  }

  // ---- entries ---------------------------------------------------------

  /**
   * Merge a new entry into an existing one (if any), running the per-
   * attribute confidence/recency reconciliation. canonical_name and
   * entity_type stay pinned to the first witness — a true rename is a
   * Tier 4.9 reflection-level concern.
   */
  private ingestEntry(incoming: WorldBibleEntry): IngestOutcome {
    const existing = this.router["structured" as never] as never; // silence ts
    void existing; // we use a public method below
    const prior = this.findEntry(incoming.entity_id);

    if (!prior) {
      this.router.write(incoming);
      return { kind: "created", asset: incoming };
    }

    const changes: AttributeChange[] = [];
    const mergedAttrs: WorldBibleAttribute[] = [...prior.attributes];

    for (const inAttr of incoming.attributes) {
      const idx = mergedAttrs.findIndex((a) => a.key === inAttr.key);
      const result = mergeAttribute(
        idx >= 0 ? mergedAttrs[idx] : undefined,
        inAttr,
      );
      const change: AttributeChange = {
        key: inAttr.key,
        kind: result.kind,
        previousValue: result.previousValue,
        newValue: result.attribute.value,
      };
      changes.push(change);
      if (idx >= 0) {
        if (result.kind !== "ignored") mergedAttrs[idx] = result.attribute;
      } else {
        mergedAttrs.push(result.attribute);
      }
    }

    const aliasSet = new Set(prior.aliases);
    const newAliases: string[] = [];
    for (const a of incoming.aliases) {
      if (!aliasSet.has(a)) {
        aliasSet.add(a);
        newAliases.push(a);
      }
    }

    const merged: WorldBibleEntry = {
      ...prior,
      attributes: mergedAttrs,
      aliases: [...aliasSet],
      relevance: prior.relevance + 1,
      last_updated_turn: incoming.provenance.source_turn_id,
      provenance: combineProvenance(prior.provenance, incoming.provenance),
      // canonical_name and entity_type stay pinned to the first witness;
      // a state change to those is a Tier 4.9 reflection-level concern.
    };

    this.router.write(merged);

    const outcomeKind: IngestOutcomeKind = decideEntryOutcome(
      changes,
      newAliases.length,
    );
    const details: EntryMergeDetails = { changes, newAliases };
    return { kind: outcomeKind, asset: merged, details: details as unknown as Record<string, unknown> };
  }

  // ---- atomic facts ----------------------------------------------------

  /**
   * Dedupe an atomic fact/opinion/etc. by content signature. On a hit,
   * bump relevance and accumulate the new anchor; on a miss, persist
   * as a new asset.
   */
  private ingestAtomic(incoming: MemoryAsset): IngestOutcome {
    const candidates = this.findAtomicCandidates(incoming);
    const match = candidates.find((c) => atomicMatches(c, incoming));

    if (!match) {
      this.router.write(incoming);
      return { kind: "created", asset: incoming };
    }

    const before = match.relevance;
    const bumped: MemoryAsset = {
      ...match,
      relevance: match.relevance + 1,
      last_updated_turn: incoming.provenance.source_turn_id,
      provenance: combineProvenance(match.provenance, incoming.provenance),
    };
    this.router.write(bumped);
    const details: AtomicBumpDetails = {
      previousRelevance: before,
      newRelevance: bumped.relevance,
      addedAnchors:
        bumped.provenance.raw_quote_anchors.length -
        match.provenance.raw_quote_anchors.length,
    };
    return { kind: "bumped", asset: bumped, details: details as unknown as Record<string, unknown> };
  }

  // ---- lore ------------------------------------------------------------

  /** Write a LoreSnippet through unmodified — lore dedup is a Tier 4.9 concern. */
  private ingestLore(incoming: LoreSnippet): IngestOutcome {
    this.router.write(incoming);
    return { kind: "created", asset: incoming };
  }

  // ---- lookups ---------------------------------------------------------

  /** Locate a stored WorldBibleEntry by `entity_id`. */
  private findEntry(entityId: string): WorldBibleEntry | undefined {
    const out = this.router.query({ entity_id: entityId });
    for (const a of out) {
      if (isWorldBibleEntry(a) && a.entity_id === entityId) return a;
    }
    return undefined;
  }

  /** Narrow the search space for dedup using the structured-store indexes. */
  private findAtomicCandidates(incoming: MemoryAsset): MemoryAsset[] {
    const filter: {
      kind: MemoryKind;
      network: Network;
      viewpoint_holder?: string;
      entity_id?: string;
    } = {
      kind: incoming.kind as MemoryKind,
      network: incoming.network as Network,
    };
    if (incoming.viewpoint_holder) {
      filter.viewpoint_holder = incoming.viewpoint_holder;
    }
    if (incoming.entity_ids.length > 0) {
      filter.entity_id = incoming.entity_ids[0]!;
    }
    return this.router
      .query(filter)
      .filter((a): a is MemoryAsset => !isWorldBibleEntry(a));
  }
}

// ---- helpers -----------------------------------------------------------

/** Type-guard for entity cards. */
function isWorldBibleEntry(asset: AnyAsset): asset is WorldBibleEntry {
  return (
    asset.kind === MemoryKind.ENTITY &&
    (asset as WorldBibleEntry).entity_id !== undefined
  );
}

/** Dedup signature for atomic assets: kind + network + viewpoint + entity_ids + normalized content. */
function atomicMatches(a: MemoryAsset, b: MemoryAsset): boolean {
  if (a.kind !== b.kind) return false;
  if (a.network !== b.network) return false;
  if (a.viewpoint_holder !== b.viewpoint_holder) return false;
  if (normalize(a.content) !== normalize(b.content)) return false;
  return sameEntitySet(a.entity_ids, b.entity_ids);
}

/** Lowercase + collapse whitespace; used as the content-equality basis. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Order-insensitive set equality over two entity-id arrays. */
function sameEntitySet(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

/** Pick the right IngestOutcomeKind based on the merge results. */
function decideEntryOutcome(
  changes: AttributeChange[],
  newAliasCount: number,
): IngestOutcomeKind {
  if (changes.some((c) => c.kind === "state_changed")) return "state_changed";
  if (changes.some((c) => c.kind === "added") || newAliasCount > 0) {
    return "merged";
  }
  return "bumped";
}
