# Top 10 — What's Next

Ordered by impact-per-effort with explicit dependencies. Each item is roughly **one PR** of scope and has concrete acceptance criteria so "done" isn't ambiguous.

Status: 🔥 unblocks the most downstream work · ⚡ quick win · 🧱 foundational

---

## 1. Claude API client 🧱 ✅ shipped

**Why:** Foundation for items #3, #8, #10 — every LLM-backed component needs this.

**Built:**
- `src/claude/client.ts` wrapping `@anthropic-ai/sdk` (`ClaudeClient`, behind a pluggable `ClaudeTransport`)
- Auth via Expo SecureStore — `src/claude/secureKeyStore.ts` (not in the `src/claude` barrel; it touches a native module, so import it directly from app code)
- Retry with jitter on 429 / 529 / transient 5xx — `src/claude/retry.ts`
- Streaming support (for chat — Tier 7) — `client.streamMessage()`
- Token + cost accounting per call, exposed for the settings dashboard — `src/claude/costTracker.ts`
- Structured-output helper (Zod schema → tool-call definition) — `src/claude/zodToJsonSchema.ts` + `client.structured()`
- Fixture-record/replay harness so Jest tests stay deterministic — `src/claude/fixtures.ts` (`FixtureTransport`)

**Done when:**
- `npm test` passes with replayed fixtures ✅ (`src/claude/__tests__/*`, plus the extractor/summarizer integration tests)
- Manual smoke: `npm run claude-smoke` (`scripts/claude-smoke.ts`) returns a tool-call response against a real key — **not run**, no API key in this dev sandbox; script is written and type-checks
- Cost tracker logs match Anthropic dashboard for a known sequence — **not verified**, same reason

**Depends on:** nothing.

---

## 2. Real Embedder 🔥

**Why:** Without this, the vector channel of fusion recall is hash noise. Today's `StubEmbedder` makes "the desert hums" similar to random strings.

**Pick one** (recommend ranked):
- **A. On-device ONNX** via `onnxruntime-react-native` with `all-MiniLM-L6-v2` — fully local, ~22 MB, ~50 ms per embed on a modern phone.
- **B. Cohere `embed-english-v3.0`** — hosted, paid, 1024-dim, fast.
- **C. OpenAI `text-embedding-3-small`** — hosted, paid, 1536-dim.

**Build:**
- New `Embedder` impl behind the existing interface
- Model id stored on every `LoreSnippet` so cross-model queries are rejected
- Re-embed migration helper for stored snippets when model changes
- Benchmark vs `StubEmbedder` on a fixed 100-snippet test set

**Done when:**
- Tier 3 integration test passes with real embedder
- Semantic recall ("the desert hums at noon" → matches "sand burns at midday") beats `StubEmbedder` on a small eval set

**Depends on:** nothing (independent of #1).

---

## 3. Claude-backed Extractor 🔥 ✅ shipped

**Why:** `PatternExtractor` only catches `"X is a Y."` form sentences. This is the actual value-prop component — automatic memory extraction from natural conversation.

**Built:**
- `src/extraction/claudeExtractor.ts` implementing `Extractor` (`ClaudeExtractor`)
- Prompt: structured-output Claude call (`extract_facts` tool) returning `ExtractedFact[]` per turn
- Anchor verification stays at the engine layer (already there) — Claude returns quotes; engine validates them against turn text
- Disposition-aware confidence calibration (Claude says 0.8, engine maps via disposition) — also already at the engine layer; the extractor just passes Claude's self-reported confidence through
- Caching by turn-content hash so the same turn isn't re-extracted

**Done when:**
- Replay-fixture tests pass over a 50-turn transcript — **partially**: `src/extraction/__tests__/claudeExtractor.test.ts` covers extraction → anchoring, anchor-guard rejection, caching, and the cost cap against a scripted (mock) transport, not a 50-turn fixture replay specifically
- Auto-Retain integration test exercises the new extractor and produces correctly-anchored assets ✅
- Cost per turn logged and under a configurable cap ✅ (`maxCostPerTurnUsd` + `onCostCapExceeded`)

**Depends on:** #1.

---

## 4. Persistent structured storage (expo-sqlite) 🧱

**Why:** Today everything evaporates on app restart. Without persistence, none of the rest of this matters in production.

**Build:**
- `src/storage/sqliteStructuredStore.ts` implementing `StructuredStore`
- Schema: one table per kind for simplicity, or one wide table with JSON columns — bench both
- Indexes mirror the in-memory ref impl (network/kind/entity-ref/tag/viewpoint)
- Migrations table + sequenced migration runner
- One-time import helper from in-memory → SQLite
- Provenance stored verbatim as JSON column (Why UI reads it back losslessly)

**Done when:**
- All Tier 1.2 in-memory tests pass against the SQLite impl (parametric test runner)
- Round-trip restart in the integration test: ingest 100 facts → close → reopen → recall finds them

**Depends on:** nothing.

---

## 5. Mobile chat surface 🔥

**Why:** No app exists yet. `App.tsx` is the default Expo blank screen. Until this is built, nobody can actually use Kleep.

**Build:**
- Replace `App.tsx` with a navigation root (React Navigation, `Stack`)
- Chat screen: turn list (FlashList), composer, role badges, streaming response renderer
- Wire to the `ConversationBuffer`; each user/AI message becomes a `Turn`
- AutoRetainEngine ticks after each new turn
- Long-press a message → quick action menu (placeholder for Why UI in #7)
- Empty state explaining what the app does

**Done when:**
- `npm run web` renders a working chat against a mocked Claude responder
- `npm run ios` + `npm run android` boot without crashing
- A 10-turn conversation triggers the full pipeline and the World Bible reflects what was said

**Depends on:** #1 for real responses (or wire a mock for now).

---

## 6. Persistent vector storage 🧱

**Why:** Embeddings need to survive restart just like structured data.

**Build:**
- `sqlite-vec` extension via `op-sqlite` (better native module than `expo-sqlite` for extensions)
- `src/storage/sqliteVectorStore.ts` implementing `VectorStore`
- Dimensionality locked at store-creation time, stored in a metadata table
- Migration: copy from in-memory at boot if not yet populated

**Done when:**
- Tier 1.2 vector tests pass against the SQLite impl
- Tier 3 integration test: ingest LORE → close → reopen → semantic recall still finds it

**Depends on:** #2 (need to know vector dimension).

---

## 7. Why UI wired into the chat ⚡

**Why:** `WhyPanel.tsx` exists and works in isolation; it has nowhere to live.

**Build:**
- Long-press on an AI message → bottom sheet with `WhyPanel` for the message's primary assets
- Per-claim hover for inline factual claims (if Tier 5.1 returns claim-level provenance)
- `onJumpToTurn` callback scrolls the chat list to the source turn and pulses it
- "Forget this" button calls `MemoryRouter.delete`

**Done when:**
- Tap a fact in a generated response → see anchors → tap an anchor → chat scrolls to the source turn

**Depends on:** #5.

---

## 8. Claude-backed Summarizer ⚡ ✅ shipped

**Why:** `StubSummarizer` emits `"[t1..t3] 3 turns: word, word, word"` — useless. With Claude, rolling summaries become actual state deltas.

**Built:**
- `src/summarization/claudeSummarizer.ts` implementing `Summarizer` (`ClaudeSummarizer`)
- Prompt template: "Given turns N..M, produce a single-paragraph state delta. Inventory, locations, relationships."
- Output validated (word-count cap, must reference at least one capitalized name pulled from the source turns when one exists)
- Falls back to `StubSummarizer` on Claude failure **or** failed output validation (broader than just "transient failure" — keeps `RollingSummarizer.tick()` from ever blocking on a bad response, not just a network error)

**Done when:**
- Rolling summarizer integration test produces summaries that pass a content-quality check (mentions ≥1 entity, ≤120 tokens) ✅ — `src/summarization/__tests__/claudeSummarizer.test.ts`, including a real `RollingSummarizer` integration test producing a `SUMMARY` asset

**Depends on:** #1.

---

## 9. Settings screen with disposition sliders ⚡

**Why:** Tier 4.10 is a feature the user can't currently touch. Sliders connect them to real behavior change.

**Build:**
- `app/settings.tsx` (Expo Router) with:
  - Skepticism slider (0–1)
  - Literalism slider (0–1)
  - Live preview: "At this setting, a 0.4-confidence fact persists after N mentions" / "WORLD facts get Nx boost"
- Persist to AsyncStorage → load on app boot → pass to engine constructors
- API key entry (SecureStore from #1)
- Cost dashboard from #1's tracker

**Done when:**
- Moving a slider mid-conversation changes engine behavior on the next tick (verified by a test conversation showing different recall ordering)

**Depends on:** #1, #5.

---

## 10. Claude-backed Reflector + background scheduler 📋

**Why:** Heuristic `StubReflector` only catches negation-pattern contradictions and exact-content corroborations. Real reflection finds subtle inconsistencies a stub never could. Plus: reflection should run unattended, not just on manual ticks.

**Build:**
- `src/reflection/claudeReflector.ts` calling Claude over the OPINION network
- Prompt: "Find contradictions/corroborations/consolidations across these opinions and facts. Return findings as structured tool calls."
- Background scheduler: `expo-task-manager` registers `ReflectionEngine.tick()` to run when battery > 30% and Wi-Fi connected
- User can manually trigger from the reflection inbox (Tier 7.6)

**Done when:**
- Claude reflector finds at least one contradiction in a fixture that `StubReflector` missed
- Background task fires unattended in a 24-hour soak test and produces reflections without crashing

**Depends on:** #1, #5 (for the inbox UI).

---

## Suggested execution order

The dependency graph collapses into roughly three waves:

**Wave 1 (parallel, foundation):** #1, #2, #4
**Wave 2 (depends on Wave 1):** #3, #5, #6
**Wave 3 (depends on Waves 1–2):** #7, #8, #9, #10

If we goal-mode the whole list, that's ~3–4 weeks of focused work at the pace we've been moving. After Wave 2, Kleep is actually usable. After Wave 3, it's a product.

See [`ROADMAP.md`](./ROADMAP.md) for the full long-term picture.
