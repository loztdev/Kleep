# Kleep Roadmap

Status: ✅ shipped · 🟡 partial · 📋 planned

---

## Tier 1 — Foundation ✅ (PR #1)

Architecture that everything else plugs into.

- **1.1 Unified Provenance Data Schema** ✅ — Every memory asset born with `source_turn_id`, `confidence_score`, `raw_quote_anchors`, `temporal_range`. Dual clock (real-world turn + in-fiction narrative). Validator enforces anchor↔source coherence.
- **1.2 Dual-Engine Storage Setup** ✅ — `StructuredStore` + `VectorStore` interfaces with in-memory ref impls. Production impls swap in behind the same shape.
- **1.3 4-Network Isolation Layer** ✅ — Data-driven `kind × network` rule matrix; `MemoryRouter` enforces, dispatches, scopes.

## Tier 2 — Ingestion Pipeline ✅ (PR #2)

Turning conversation into structured memory.

- **2.4 Auto-Retain Extraction Engine** ✅ — Buffer with high-water mark; pluggable `Extractor`; verbatim-quote anti-hallucination guard; `Embedder` seam; `IngestSink` for downstream choice.
- **2.5 Deduplication & State-Tracking** ✅ — Stateless reconciler; per-attribute merge by confidence + recency; corroboration via anchor accumulation; `IngestOutcome` (created/bumped/merged/state_changed).

## Tier 3 — Retrieval & Compression ✅ (PR #3)

Prompts stay small, answers stay relevant.

- **3.6 4-Way Fusion Recall** ✅ — BM25 + vector + entity-graph + chronological combined via Reciprocal Rank Fusion. Network/viewpoint scope, token budget.
- **3.7 Rolling State-Delta Summarizer** ✅ — Token-threshold trigger; `SUMMARY` assets with per-turn anchors.

## Tier 4 — Reflection, Traceability, Tuning ✅ (PR #4)

The "elite" features from the original spec.

- **4.8 Why UI** ✅ — `ProvenanceBundle` data layer + `WhyPanel.tsx` React Native component.
- **4.9 CARA Reflection Layer** ✅ — Reflector interface + heuristic stub; emits `REFLECTION` assets with confidence/relevance effects.
- **4.10 Disposition Matrix** ✅ — Skepticism + literalism sliders wired into extraction and recall.
- **4.x Docs pass** ✅ (PR #6) — ~92% of top-level exports have JSDoc.

---

## Tier 5 — Real Components 📋

Each is independent, unblocked, and slots in behind an existing interface.

- **5.1 Claude-backed Extractor** — Replace `PatternExtractor` with structured-output Claude call.
- **5.2 Real Embedder** — On-device ONNX sentence-transformers OR hosted (Cohere/Voyage/OpenAI).
- **5.3 Claude-backed Summarizer** — Real "state delta" prompt.
- **5.4 Claude-backed Reflector** — Smarter contradiction/consolidation than the heuristic.
- **5.5 Claude API client** — Auth, retry with jitter, streaming, error taxonomy, cost tracking. Foundation for 5.1/5.3/5.4.

## Tier 6 — Persistence 📋

- **6.1 SQLite-backed `StructuredStore`** — `expo-sqlite` impl behind the same interface.
- **6.2 On-device vector store** — `sqlite-vec` extension or ObjectBox.
- **6.3 Persistent retrieval indexes** — BM25 + entity in SQLite (or rebuild-on-load).
- **6.4 Pending-mentions persistence** — Skepticism-gate queue survives restart.

## Tier 7 — Mobile App Surface 📋

The actual product the user sees.

- **7.1 Chat surface** — Turn list, composer, streaming responses, jump-to-turn affordance.
- **7.2 Why UI integration** — Long-press / "?" affordance on AI output → `WhyPanel`.
- **7.3 Settings** — Disposition sliders, model picker, API key entry, cost dashboard.
- **7.4 World Bible browser** — Per-entity view with per-attribute provenance + edit affordance.
- **7.5 Lore book viewer** — Browse vector store; tag editor.
- **7.6 Reflection inbox** — Surface new `REFLECTION` assets; accept/dismiss with effect application.

## Tier 8 — User-Requested Extras 🟡 / 📋

From the original kickoff message.

- **8.1 Auto rolling summaries** ✅ (Tier 3.7)
- **8.2 Auto lorebooks** 🟡 — Schema ✅; Claude extractor (5.1) must emit LORE; lorebook viewer (7.5).
- **8.3 Auto world bibles with semantic formatting** 🟡 — Entity cards ✅; per-`entity_type` schemas (`character.hp`, `location.climate`) via an `EntityTypeRegistry`; pretty serialization for prompts.
- **8.4 Hierarchical context anchoring** 📋 — Add `Scene` and `Chapter` levels above `Turn`; fusion boosts same-scene results; UI breadcrumb.
- **8.5 State-tracking tokens** 📋 — Compact `[turn:N] hp -10 → 32` deltas for prompt injection (distinct from rolling summary).
- **8.6 Pseudo-weights** 🟡 — Disposition matrix ✅; broader per-asset trust weights that decay/compound with corroboration. Compose into `effectiveScore(asset, query, disposition)`.

## Tier 9 — Production Concerns 📋

- **9.1 Auth** — Account creation, sign-in.
- **9.2 Cloud sync** — Conflict resolution (CRDT? vector clocks?).
- **9.3 Background scheduler** — Expo TaskManager / iOS BGProcessing for `ReflectionEngine.tick()`.
- **9.4 Telemetry** — Retrieval-quality metrics, Claude cost/latency, reflection acceptance rate.
- **9.5 Privacy controls** — Per-entry "do not export", full-corpus wipe.

## Tier 10 — Stretch / Long-Horizon 📋

Ideas, not committed.

- **10.1 Multi-character viewpoint switching** — Render the world from Alice's vs Bob's POV in real time.
- **10.2 Time-travel queries** — "What did the system believe at turn 50?"
- **10.3 Multi-modal lore** — Images/audio with CLIP-style embeddings.
- **10.4 Collaborative worlds** — Two users in one world bible.
- **10.5 On-device LLM** — Llama/Qwen via `react-native-executorch` for offline mode.

---

For the focused "what's next, in order" list, see [`NEXT-10.md`](./NEXT-10.md).
