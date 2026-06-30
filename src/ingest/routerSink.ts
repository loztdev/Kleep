/**
 * Adapter — turns a MemoryRouter into an IngestSink for callers that
 * don't need reconciliation. Always reports `created`. Useful for
 * Tier 2.4 in isolation, and as a baseline for tests.
 */

import type { MemoryRouter } from "../router";
import type { AnyAsset, IngestOutcome, IngestSink } from "./types";

/** Thin `IngestSink` adapter that writes directly to a `MemoryRouter`. */
export class RouterSink implements IngestSink {
  /** @param router The router to write through. */
  constructor(private readonly router: MemoryRouter) {}

  /** Write `asset` directly to the router; outcome is always `created`. */
  ingest(asset: AnyAsset): IngestOutcome {
    this.router.write(asset);
    return { kind: "created", asset };
  }
}
