/**
 * Tier 1.3: 4-Network Isolation Rules.
 *
 * The Hindsight 4-network model splits ingested data into:
 *
 * - WORLD       physics, hard rules, canonical setting facts
 * - EXPERIENCE  biography — what actually happened
 * - OBSERVATION neutral, currently-true facts about entities
 * - OPINION     subjective beliefs held by a viewpoint
 *
 * Not every (kind, network) combination makes sense. These rules
 * encode "what belongs where" so the router can refuse to mix
 * incompatible content — opinions never leak into the canonical
 * WORLD, hard physical RULEs never live inside someone's head, etc.
 *
 * The matrix is small enough to spell out; doing it as data (vs.
 * scattered ifs) keeps it auditable.
 */

import { MemoryKind, Network } from "../schema";

const ALL_NETWORKS: readonly Network[] = [
  Network.WORLD,
  Network.EXPERIENCE,
  Network.OBSERVATION,
  Network.OPINION,
];

const RULES: Readonly<Record<MemoryKind, readonly Network[]>> = {
  // Hard rules are by definition WORLD-level — physics, mechanics, setting law.
  [MemoryKind.RULE]: [Network.WORLD],
  // Entity cards are WORLD (canonical) or OBSERVATION (currently-true).
  [MemoryKind.ENTITY]: [Network.WORLD, Network.OBSERVATION],
  // Atomic claims about reality — never opinion (those are MemoryKind.OPINION).
  [MemoryKind.FACT]: [Network.WORLD, Network.EXPERIENCE, Network.OBSERVATION],
  // Opinions are subjective by construction.
  [MemoryKind.OPINION]: [Network.OPINION],
  // Lore is descriptive prose; can ride any network (worldbuilding lore,
  // historical lore, observational sketches, in-character musings).
  [MemoryKind.LORE]: ALL_NETWORKS,
  // Roll-ups and reflections can summarize any network.
  [MemoryKind.SUMMARY]: ALL_NETWORKS,
  [MemoryKind.REFLECTION]: ALL_NETWORKS,
};

/** Thrown when an asset's (kind, network) pair violates the isolation matrix. */
export class NetworkRuleViolation extends Error {
  constructor(
    public readonly kind: MemoryKind,
    public readonly network: Network,
    public readonly reason: string,
  ) {
    super(`network rule violation: ${reason} (kind=${kind}, network=${network})`);
    this.name = "NetworkRuleViolation";
  }
}

/** Networks this kind is permitted to live in. */
export function allowedNetworks(kind: MemoryKind): readonly Network[] {
  return RULES[kind];
}

/** True if `(kind, network)` is a permitted combination. */
export function isAllowed(kind: MemoryKind, network: Network): boolean {
  return RULES[kind].includes(network);
}

/** Throws `NetworkRuleViolation` if `(kind, network)` is not permitted. */
export function assertAllowed(kind: MemoryKind, network: Network): void {
  if (!isAllowed(kind, network)) {
    throw new NetworkRuleViolation(
      kind,
      network,
      `${kind} is not allowed in the ${network} network — permitted: ${allowedNetworks(
        kind,
      ).join(", ")}`,
    );
  }
}
