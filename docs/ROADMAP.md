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

## Tier 5 — Real Components 🟡

Each is independent, unblocked, and slots in behind an existing interface.

- **5.1 LLM-backed Extractor** ✅ — `LlmExtractor` (`src/extraction/llmExtractor.ts`, renamed from `ClaudeExtractor` once it went provider-agnostic): structured-output call per turn, turn-content-hash caching, per-turn cost-cap callback. Anchor verification and disposition-aware confidence calibration were already at the `AutoRetainEngine` layer, so the extractor itself just has to return well-formed quotes. Runs on any `LlmProvider` (Claude or OpenRouter).
- **5.2 Real Embedder** 📋 — On-device ONNX sentence-transformers OR hosted (Cohere/Voyage/OpenAI). Not started — needs either a model download (on-device) or a paid hosted API key, neither available in a sandboxed dev session.
- **5.3 LLM-backed Summarizer** ✅ — `LlmSummarizer` (`src/summarization/llmSummarizer.ts`, renamed from `ClaudeSummarizer`): real state-delta prompt, output validated (word cap + must reference a name from the source turns when one exists), falls back to `StubSummarizer` on API failure or failed validation so rolling never blocks. Runs on any `LlmProvider`.
- **5.4 Claude-backed Reflector** 📋 — Smarter contradiction/consolidation than the heuristic. Not started this pass.
- **5.5 Claude API client** ✅ — `src/claude/`: `ClaudeClient` wraps `@anthropic-ai/sdk` behind a pluggable `ClaudeTransport`. Retry-with-jitter on 429/529/5xx, per-call cost accounting (`CostTracker`, `src/claude/costTracker.ts`), a Zod→tool-schema structured-output helper (`client.structured()`), basic streaming (`client.streamMessage()`), and a fixture record/replay transport (`src/claude/fixtures.ts`) so `npm test` never needs a real key. Manual smoke test: `npm run claude-smoke` (needs `ANTHROPIC_API_KEY`; not run in CI).
- **5.6 OpenRouter client + generic provider interface** ✅ (new, by request) — `src/llm/`: `LlmProvider` interface (`sendMessage`/`structured`/`streamMessage`/`totalCostUsd`) implemented by `ClaudeProvider` (adapts `ClaudeClient`) and `OpenRouterClient` (new, fetch-based OpenAI-compatible client — retry+jitter, cost from OpenRouter's native `usage.cost`, Zod-backed function-calling, SSE streaming, fixture record/replay). `buildLlmProvider()` + `secureKeyStore.ts` handle connect-time provider selection. Manual smoke test: `scripts/openrouter-smoke.ts` (needs `OPENROUTER_API_KEY`) — **not run**, this dev sandbox's egress policy blocks `openrouter.ai` outright even with a real key provided; verified instead against a mocked `fetch` (`src/llm/openrouter/__tests__/realTransport.test.ts`).

## Tier 6 — Persistence 🟡

- **6.1 SQLite-backed `StructuredStore`** ✅ — `src/storage/sqliteStructuredStore.ts`, `expo-sqlite`'s sync API (`execSync`/`runSync`/`getAllSync`/`getFirstSync`) behind the exact same `StructuredStore` interface — no async refactor needed anywhere in the memory pipeline. One wide table + a JSON `data` column (provenance round-trips losslessly) plus two junction tables (entity refs, tags) for indexed filtering. Verified against a shared parametric contract test suite run against both `InMemoryStructuredStore` and this impl (`src/storage/__tests__/structuredStore.contract.ts`), using `better-sqlite3` as a real-SQLite Jest-runnable stand-in for `expo-sqlite` (a native module).
- **6.2 On-device vector store** ✅ (scoped) — `src/storage/sqliteVectorStore.ts`, same contract-test approach. Deliberately does NOT use the `sqlite-vec` extension (a native SQLite extension bundled via an Expo config plugin — unverifiable from this sandbox, real regression risk for a lore-book size this app will realistically hold); embeddings persist as JSON and are scored via the identical linear-scan cosine similarity `InMemoryVectorStore` already uses. Durability, not query-time acceleration — revisit if lore volume ever makes the scan too slow.
- **6.3 Persistent retrieval indexes** 📋 — BM25/entity-graph indexes still rebuild in memory from the structured store on boot; not yet incremental/persisted themselves.
- **6.4 Pending-mentions persistence** 📋 — Skepticism-gate queue still doesn't survive restart.
- **6.5 Chat session + turn persistence** ✅ (new, not originally scoped in Tier 6) — `src/storage/chatSessionStore.ts` + `src/conversation/buffer.ts`'s `ConversationBuffer.fromPersisted()`. Multiple named chat sessions, each a full transcript (`chat_turns`) with high-water mark and summarized-turn state, so `ConversationBuffer` rebuilds exactly as it was rather than re-running extraction/summarization on reload. Sessions are per-conversation; `structured`/`vector` (6.1/6.2) are one continuous memory shared across every session — that's the point of a biomimetic memory that keeps learning across conversations instead of resetting per chat.
- **Web scope note:** `expo-sqlite` has no sync API on web (see `openKleepDatabase.ts`) — same policy as `secureKeyStore.ts`: web falls back to a fresh in-memory pipeline and skips the chat list entirely (single ephemeral chat), since web is this project's debug/testing target, not its distribution target.

## Tier 7 — Mobile App Surface 🟡

The actual product the user sees.

- **7.1 Chat surface** 🟡 — Dark-theme redesign shipped: `src/ui/ChatScreen.tsx` (turn list, composer, non-streaming send/receive, best-effort `AutoRetainEngine`/`RollingSummarizer` ticks after each reply) and `src/ui/ConnectScreen.tsx` (provider + API key entry, wired to `secureKeyStore.ts`/`buildLlmProvider()`). Per-message actions: assistant replies can be **regenerated** or **copied**; user messages can be **edited** — both regenerate and edit compute the new reply *before* mutating `ConversationBuffer` (`truncateFrom`/`contextBefore`), so a failed call leaves the existing conversation untouched instead of needing a rollback. Edit/regenerate are "branch" operations in the sense that they discard the turn (and anything after it) and replay from there; the discarded suffix isn't kept as a switchable alternate branch, just dropped (known gap, documented in NEXT-10.md — already-extracted facts from a discarded turn currently linger in the shared memory stores). `src/ui/ChatListScreen.tsx` (new) sits between Connect and an individual chat on native — create/rename/delete sessions, each a full persisted transcript (Tier 6.5) sharing one continuous memory. Verified live in a browser (Playwright) against the connect flow, dark-theme rendering, and the edit interaction; native-only pieces (chat list, real on-device persistence) can't be exercised from this sandbox (no simulator), so they're covered by the storage-layer Jest tests instead. Still missing: streaming responses, jump-to-turn affordance, persisted/switchable branches.
- **7.2 Why UI integration** — Long-press / "?" affordance on AI output → `WhyPanel`.
- **7.3 Settings** 🟡 — API key entry + provider picker ✅ (`ConnectScreen.tsx`, a first pass at connect-time only, not a full settings screen). Disposition sliders, model picker, and cost dashboard still 📋.
- **7.4 World Bible browser** — Per-entity view with per-attribute provenance + edit affordance.
- **7.5 Lore book viewer** — Browse vector store; tag editor.
- **7.6 Reflection inbox** — Surface new `REFLECTION` assets; accept/dismiss with effect application.

**Known tech debt:** `@expo/vector-icons` (used by `ChatScreen.tsx`'s message-action icons) is deprecated as of Expo SDK 56 in favor of the scoped `@react-native-vector-icons/*` packages. Still functions today — the CI Android build succeeds with it — but deliberately not migrated yet, since swapping icon libraries for a non-urgent deprecation carries real regression risk for no immediate benefit. Revisit before Expo actually removes it from a future SDK.

## Tier 8 — User-Requested Extras 🟡 / 📋

From the original kickoff message.

- **8.1 Auto rolling summaries** ✅ (Tier 3.7)
- **8.2 Auto lorebooks** 🟡 — Schema ✅; `ClaudeExtractor` (5.1) ✅ can emit LORE-kind facts (prompted for it, untested against a real model — no API key in dev sandbox); still needs the lorebook viewer (7.5).
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
