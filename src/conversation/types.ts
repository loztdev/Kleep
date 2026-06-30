/**
 * Conversation primitives consumed by the AutoRetainEngine (Tier 2.4).
 *
 * A `Turn` is a single message in the chat. The buffer accumulates
 * turns and tells the engine which ones haven't been extracted yet.
 */

import type { TurnId } from "../schema";

export const TurnRole = {
  USER: "user",
  ASSISTANT: "assistant",
  NARRATOR: "narrator",
  SYSTEM: "system",
} as const;

export type TurnRole = (typeof TurnRole)[keyof typeof TurnRole];

export interface Turn {
  id: TurnId;
  role: TurnRole;
  /** Raw text of the message — the only thing the extractor reads. */
  content: string;
  /**
   * Monotonic ordering hint. Real-time clocks are deliberately external
   * (caller supplies); the schema treats this as opaque ordering.
   */
  index: number;
}
