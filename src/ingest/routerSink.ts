/**
 * Adapter — turns a MemoryRouter into an IngestSink for callers that
 * don't need reconciliation. Always reports `created`. Useful for
 * Tier 2.4 in isolation, and as a baseline for tests.
 */

import type { MemoryRouter } from "../router";
import type { AnyAsset, IngestOutcome, IngestSink } from "./types";

export class RouterSink implements IngestSink {
  constructor(private readonly router: MemoryRouter) {}

  ingest(asset: AnyAsset): IngestOutcome {
    this.router.write(asset);
    return { kind: "created", asset };
  }
}
