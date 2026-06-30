/**
 * Tier 4.8 — Why UI public surface.
 *
 * The data layer (`explain`, `explainAttribute`, `explainAllAttributes`,
 * `ProvenanceBundle`) is pure TS and ships on any platform. The React
 * Native component (`WhyPanel`) lives in `./WhyPanel.tsx` and consumes
 * the data layer; it's imported by the app, not re-exported here, so
 * Jest's node test environment doesn't drag in React Native modules.
 */

export type {
  AnchorView,
  ConfidenceView,
  ProvenanceBundle,
  TemporalView,
} from "./types";
export {
  explain,
  explainAttribute,
  explainAllAttributes,
} from "./explain";
