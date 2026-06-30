/**
 * The 4-Network taxonomy from Hindsight (Tier 1.3 preview).
 *
 * Defined here in Tier 1.1 because every memory asset declares which
 * network it belongs to at creation time. The isolation *logic* —
 * routing, cross-network reconciliation — comes later; this is just the
 * vocabulary.
 *
 * - WORLD: physics, hard rules, canonical setting facts.
 * - EXPERIENCE: biographical events — what actually happened in the story.
 * - OBSERVATION: neutral, currently-true facts about entities.
 * - OPINION: subjective, mutable beliefs held by some viewpoint.
 */

import { z } from "zod";

export const Network = {
  WORLD: "world",
  EXPERIENCE: "experience",
  OBSERVATION: "observation",
  OPINION: "opinion",
} as const;

export type Network = (typeof Network)[keyof typeof Network];

export const NetworkSchema = z.enum([
  Network.WORLD,
  Network.EXPERIENCE,
  Network.OBSERVATION,
  Network.OPINION,
]);
