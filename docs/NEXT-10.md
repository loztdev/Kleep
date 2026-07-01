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

## 4. Persistent structured storage (expo-sqlite) 🧱 ✅ shipped

**Why:** Today everything evaporates on app restart. Without persistence, none of the rest of this matters in production.

**Built:**
- `src/storage/sqliteStructuredStore.ts` implementing `StructuredStore` — one wide table (`structured_assets`) with the full validated asset as a JSON `data` column (provenance round-trips losslessly for the Why UI) plus indexed scalar columns and two junction tables (`structured_asset_entity_refs`, `structured_asset_tags`) mirroring the in-memory ref impl's network/kind/entity-ref/tag/viewpoint indexes
- `src/storage/sql/schema.ts` — a `migrations` table + sequenced, idempotent migration runner
- `src/storage/sql/types.ts` — a minimal `SqlDatabase` seam (mirrors the `ClaudeTransport`/`OpenRouterTransport` pattern) so the real logic runs against `expo-sqlite`'s sync API in the app and `better-sqlite3` in tests
- Went with the **synchronous** `expo-sqlite` API (`execSync`/`runSync`/`getAllSync`/`getFirstSync`, not the `*Async` one) specifically so `StructuredStore`/`VectorStore` — and everything built on them (`MemoryRouter`, `DedupReconciler`, `AutoRetainEngine`) — didn't need an async rewrite

**Done when:**
- All Tier 1.2 in-memory tests pass against the SQLite impl ✅ — `src/storage/__tests__/structuredStore.contract.ts`, one shared parametric suite run against both `InMemoryStructuredStore` and `SqliteStructuredStore`
- Round-trip restart in the integration test: ingest 100 facts → close → reopen → recall finds them — **not verified this way**: the contract suite's test databases are `better-sqlite3`'s `:memory:` (fresh per test, by design — full isolation, no cross-test pollution), so it proves query/index correctness against a real SQLite engine but doesn't exercise an actual close-the-handle-and-reopen-the-same-file restart. That specific property can only really be checked against a real on-device file-backed database (`expo-sqlite`'s `openDatabaseSync("kleep.db")`), which needs a device/simulator this sandbox doesn't have.

**Depends on:** nothing.

---

## 5. Mobile chat surface 🔥 🟡 first pass shipped

**Why:** No app exists yet. `App.tsx` is the default Expo blank screen. Until this is built, nobody can actually use Kleep.

**Built (first pass — no navigation stack yet, single screen):**
- `App.tsx` now gates on a connect flow instead of the Expo placeholder: `src/ui/ConnectScreen.tsx` (pick Claude or OpenRouter, paste an API key, optional model override) → `src/ui/ChatScreen.tsx`
- Chat screen: message list (plain `ScrollView` — not `FlashList` yet), composer, send button, empty state
- Dark theme throughout (`app.json`'s `userInterfaceStyle: "dark"`, backed by `expo-system-ui` so it actually applies on native, not just component-level styling)
- Per-message actions: assistant replies can be **regenerated** (re-run `generateReply` over the same context) or **copied** (`expo-clipboard`); user messages can be **edited**. Both regenerate and edit compute the new reply *before* mutating the buffer — `ConversationBuffer.contextBefore()`/`truncateFrom()` — so a failed call leaves the existing conversation untouched instead of needing a rollback. These are "branch" operations in the sense that they discard the target turn (and anything after it) and replay from there; since Tier 6 persistence doesn't exist, the discarded suffix isn't kept as a switchable alternate branch, just dropped
- Wire to `ConversationBuffer` via `src/ui/memoryEngine.ts`; each user/AI message becomes a `Turn`
- `AutoRetainEngine` and `RollingSummarizer` both tick after every assistant reply (best-effort — a flaky extraction call surfaces as a `console.warn`, not a crashed chat)
- Empty state explaining what the app does
- Deliberately **non-streaming** (`sendMessage`, not `streamMessage`) — React Native's `fetch` doesn't reliably support streaming response bodies across platforms (especially Android) without extra polyfills; shipping a reliable v1 beat a flaky streaming one. Both `OpenRouterClient` and `ClaudeProvider` already support `streamMessage` for whenever that's worth revisiting.
- No React Navigation stack, no long-press quick-action menu (Why UI placeholder), no persisted/switchable branches, no persistence (Tier 6) — conversation and everything the memory pipeline learned reset on reload
- **Known gap (deliberately deferred, flagged in review):** `truncateFrom()` only removes turns from `ConversationBuffer` — any `MemoryAsset`s the `AutoRetainEngine` already extracted from a since-discarded turn stay in `StructuredStore`/`VectorStore` and can still surface in recall. Retracting them properly needs `StructuredStore`/`VectorStore` to support querying by `source_turn_id`, plus a decision on partial retraction for facts whose confidence was bumped by both a kept turn and a discarded one (not just delete-the-whole-asset). Real architectural work, not a quick patch — revisit alongside Tier 6 persistence, since that's when branch semantics need a real design anyway rather than a second pass at in-memory-only retraction.

**Done when:**
- `npm run web` renders a working chat ✅ — verified by hand: connect flow → send a message → (in this dev sandbox, the network call to the configured provider is blocked by egress policy, so this specifically exercised and confirmed the *error-handling* path — a clean inline banner, no crash) plus the dark theme rendering and the edit interaction (inline text field, cancel/confirm icons) → see `src/ui/__tests__/memoryEngine.test.ts` for the automated equivalent (scripted transport, no real network) proving a real reply **does** flow through `AutoRetainEngine`/`RollingSummarizer` correctly, and `src/conversation/__tests__/buffer.test.ts` for `contextBefore`/`truncateFrom`
- `npm run ios` + `npm run android` boot without crashing — **not verified**, no simulators available in this sandbox (see #12 for a real device-installable build via CI instead)
- A 10-turn conversation triggers the full pipeline and the World Bible reflects what was said — verified at small scale via the automated test above; not run manually for 10 real turns (no live provider access from this sandbox)
- Regenerate/edit produce a fresh reply and don't corrupt the buffer on failure — verified via the `contextBefore`/`truncateFrom` unit tests; not run against a real model round-trip for the same egress reason as above

**Depends on:** #1 for real responses — now also runs on OpenRouter (see below), not just Claude.

---

## 11. OpenRouter support + generic provider interface ⚡ (not in the original top-10, added by request)

**Why:** Decouples Kleep's LLM-backed components from Anthropic specifically — run extraction, summarization, and chat on OpenRouter (any of its hundreds of models) or Claude, picked at connect time.

**Built:**
- `src/llm/` — provider-agnostic `LlmProvider` interface (`sendMessage`, `structured`, `streamMessage`, `totalCostUsd`) that `ClaudeProvider` (adapts the existing `ClaudeClient`) and `OpenRouterClient` (new — fetch-based, OpenAI-compatible Chat Completions, retry+jitter, cost from OpenRouter's native `usage.cost` field, Zod-backed structured output via OpenAI function-calling, SSE streaming) both implement
- `LlmExtractor`/`LlmSummarizer` (renamed from `ClaudeExtractor`/`ClaudeSummarizer`) now take any `LlmProvider`
- `src/llm/buildProvider.ts` + `src/llm/secureKeyStore.ts` — connect-time provider selection persisted to SecureStore (no-op on web; see module doc)
- `scripts/openrouter-smoke.ts` — manual smoke test, mirroring `claude-smoke.ts`

**Done when:**
- `npm test` passes with mocked-`fetch`/fixture-replay coverage ✅ (`src/llm/openrouter/__tests__/*`, `src/llm/__tests__/*`)
- Manual smoke test against the real OpenRouter API — **not run**: this sandbox's egress proxy hard-denies `openrouter.ai` outright (confirmed via the proxy's own status endpoint as a policy denial, not a transient failure) even with a real key provided. Run `scripts/openrouter-smoke.ts` somewhere with network access to verify the live wire format.

**Depends on:** nothing new — reuses #1's Zod→tool-schema converter (now provider-agnostic at `src/llm/zodToJsonSchema.ts`) and hash utility.

---

## 12. Android APK build via GitHub Actions ⚡ (not in the original top-10, added by request)

**Why:** #5 shipped a working chat screen, but nobody could actually install it on a phone without a local Android/EAS toolchain. A CI-built APK closes that gap with zero paid services or secrets.

**Built:**
- `.github/workflows/android-apk.yml` — on push to `main`, PRs into `main`, and manual dispatch: `npx expo prebuild --platform android` generates the native project fresh (not committed — `android/`/`ios/` stay gitignored, matching managed-workflow convention), then `./gradlew assembleRelease` builds a **release** APK, uploaded as a workflow artifact
- `app.json`: added `android.package` (`dev.loztdev.kleep`, required for `expo prebuild`) and `expo-system-ui` so `userInterfaceStyle: "dark"` actually takes effect natively, not just via component-level styling
- `metro.config.js` + `metroNodeStub.js`: `@anthropic-ai/sdk` unconditionally imports `node:fs`/`node:path` at module scope for an optional file-based credential-storage feature this app never uses (`ClaudeClient`/`ClaudeProvider` always take an explicit `apiKey`) — Metro has no Node core-module resolution, so bundling for a native target failed to resolve those specifiers even though the code paths that use them are never reached. A `resolver.resolveRequest` override stubs both to an empty module.
- GitHub-hosted `ubuntu-latest` runners ship with the Android SDK preinstalled, so the workflow only needs a JDK (`actions/setup-java`) on top of Node — no SDK install step

**Done when:**
- `expo prebuild --platform android` resolves cleanly against `app.json` ✅ — run locally in this sandbox as a sanity check (the generated `android/` dir was deleted afterward, matching `.gitignore`)
- A pushed commit produces a downloadable, installable APK ✅ — took three real CI runs to get right, each catching a real issue: (1) the first run built and uploaded `kleep-debug-apk` successfully, but a **debug** build doesn't embed the JS bundle (expects a live Metro server on the dev machine), so it showed a red "Unable to load script" screen on install; (2) switching to `assembleRelease` (still no signing secrets needed — Expo's generated `build.gradle` points the release signing config at the auto-generated debug keystore by default) surfaced a second issue: Metro couldn't bundle `@anthropic-ai/sdk`'s `node:fs`/`node:path` imports for a native target; (3) fixed with the `metro.config.js` stub above, reproduced and confirmed locally via `expo export --platform android` before pushing. CI run #6 (`kleep-release-apk`, 32.9MB) is the first one to actually build clean end-to-end — still needs a real device install to close the loop, since that's what caught issue (1) in the first place and this sandbox can't do that verification step itself.

**Depends on:** #5 (there has to be an app worth installing first).

---

## 6. Persistent vector storage 🧱 ✅ shipped (scoped — no sqlite-vec)

**Why:** Embeddings need to survive restart just like structured data.

**Built:**
- `src/storage/sqliteVectorStore.ts` implementing `VectorStore` — embeddings persist as a JSON column, scored via the exact same cosine-similarity linear scan `InMemoryVectorStore` uses (no `sqlite-vec`/native extension — see below)
- Dimensionality locked at first upsert; after a reload, inferred from an existing row instead of resetting, so a freshly-opened store doesn't silently forget its own dimension
- Deliberately skipped `sqlite-vec`/`op-sqlite`: a native SQLite extension bundled via an Expo config plugin is unverifiable from this sandbox (no device to confirm it actually loads) and a real jump in risk for a lore-book size this app will realistically hold in the near term. What this buys is durability across restarts, not query-time acceleration at scale — revisit if lore volume ever makes a linear scan too slow.

**Done when:**
- Tier 1.2 vector tests pass against the SQLite impl ✅ — `src/storage/__tests__/vectorStore.contract.ts`, run against both `InMemoryVectorStore` and `SqliteVectorStore`
- Tier 3 integration test: ingest LORE → close → reopen → semantic recall still finds it — **not verified this way**, same `:memory:`-per-test caveat as item #4; real restart durability needs a device

**Depends on:** #2 (need to know vector dimension) — not blocking in practice, since `StubEmbedder`'s fixed dimension is all either store has ever needed so far.

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

## 13. Chat sessions + chat list UI ⚡ (not in the original top-10, added by request)

**Why:** #4/#6 give the memory pipeline somewhere durable to live, but there was still exactly one ephemeral conversation and no way to have more than one. "Chat history, stored locally" was the actual ask — a `ChatSessionStore` plus a real navigation surface on top of it.

**Built:**
- `src/storage/chatSessionStore.ts` — new (not part of the original Tier 6 scope, which only covered the memory stores): `chat_sessions` + `chat_turns` tables, one row per turn with its high-water-mark/summarized state so a reloaded session doesn't need to re-run extraction/summarization against the LLM to recover where it left off
- `ConversationBuffer.fromPersisted()` (`src/conversation/buffer.ts`) — rebuilds a buffer from persisted turns + restores the processed-count/summarized state directly, rather than re-deriving it
- `src/ui/ChatListScreen.tsx` (new) — create/rename/delete sessions; `App.tsx` restructured into a `loading → disconnected → chatList → chat` state machine (native), or straight to a single ephemeral `chat` on web (no `sessionStore` there — see Tier 6's web scope note)
- `src/ui/memoryEngine.ts`'s `buildMemoryEngine()` now takes injectable `structured`/`vector`/`buffer` (defaulting to fresh in-memory, so every existing test and the web fallback path are unchanged) plus a new `syncSessionProgress()` helper that mirrors a buffer's processed/summarized state into its session after each pipeline tick

**Scope call worth flagging:** sessions share ONE continuous memory (`structured`/`vector` live on the connected-provider context, not per-session) — only the conversation transcript is per-chat. That's a deliberate reading of "biomimetic memory" (it should keep learning across conversations, not reset per thread), not an oversight; say so if isolated per-chat memory was actually wanted instead.

**Done when:**
- `ChatSessionStore` round-trips sessions/turns/high-water-mark/summarized-state ✅ — `src/storage/__tests__/chatSessionStore.test.ts`
- `ConversationBuffer.fromPersisted()` rebuilds exactly ✅ — new tests in `src/conversation/__tests__/buffer.test.ts`
- `syncSessionProgress()` persists tick progress correctly ✅ — `src/ui/__tests__/memoryEngine.test.ts`
- Full app flow (Connect → chat list → new chat → send → close → reopen chat list → same chat shows the same messages) — **not verified end-to-end**: the web fallback path (Connect → ephemeral chat) was re-verified live via Playwright after this restructure and still works, but the native chat-list flow itself needs a real device/simulator this sandbox doesn't have

**Depends on:** #4, #6 (there has to be somewhere for a session's memory writes to land).

---

## 14. Live model browser ⚡ (not in the original top-10, added by request)

**Why:** Typing a model id by hand is exactly how you end up connected to `z-ai/glm-5.2` when you meant a different id — a live, searchable catalog removes the guessing.

**Built:**
- `src/llm/openrouter/models.ts` — `listOpenRouterModels()`, `GET /api/v1/models` (public, no key)
- `src/claude/models.ts` — `listClaudeModels(apiKey)`, `GET /v1/models` with `x-api-key`/`anthropic-version` headers (no typed method for this in the pinned `@anthropic-ai/sdk` version, so a plain fetch)
- Both normalize to a shared `ModelInfo { id, label, description? }` (`src/llm/modelCatalog.ts`)
- `src/ui/ModelPickerModal.tsx` — searchable full-screen modal, wired into `ConnectScreen.tsx`'s "Browse" button next to the model field; still just fills in the same free-text field rather than replacing it, so a model id the catalog doesn't happen to list (brand new release, etc.) can still be typed by hand
- Reused `ChatScreen.tsx`'s friendly-network-error helper (extracted to `src/ui/friendlyError.ts`) so a fetch failure here reads the same plain-language way it does in chat

**Done when:**
- Both fetchers normalize real API response shapes correctly ✅ — `src/llm/openrouter/__tests__/models.test.ts`, `src/claude/__tests__/models.test.ts`, mocked `fetch`
- A live catalog actually loads in the picker — **not verified**: this sandbox's egress policy blocks both `openrouter.ai` and (untested either way) `api.anthropic.com`; confirmed instead that the modal's loading/error states render correctly (Playwright) and that the error path shows the friendly message, not a raw "Failed to fetch"

**Depends on:** #11 (OpenRouter client) for `LlmProviderKind`/`buildLlmProvider`; nothing else.

---

## 15. Memory browser: World Bible + Lore cards ⚡ (not in the original top-10, added by request)

**Why:** "Do we have biomimetic memory, or nah?" — yes, but there was no way to actually look at what it had learned. A cards-first browser (per request: "start with cards, add graph after") for the two stores every chat session shares.

**Built:**
- `VectorStore.list(filter?)` (`src/storage/types.ts`) — new interface method, implemented on both `InMemoryVectorStore` and `SqliteVectorStore`: every stored `LoreSnippet` matching an optional network/tag/viewpoint_holder filter, unordered, no embedding required. `query()` (top-K semantic search) was never meant to serve "just list everything" — this was a real gap, not a workaround.
- `src/ui/MemoryBrowserScreen.tsx` (new) — two tabs. "World Bible" lists every `WorldBibleEntry` (`structured.query({kind: MemoryKind.ENTITY})`) as a card; tapping one opens a detail modal with every attribute plus a per-attribute "Why do I know this?" button (`explainAttribute()` → `WhyPanel`) and an entity-level one (`explain()`). "Lore" lists every snippet via the new `list()`, same why-button pattern.
- `App.tsx` gained a `"memory"` app state (`{ ctx, returnTo }`, so closing it goes back to whichever screen opened it) reachable from a header icon on both `ChatListScreen` (native) and `ChatScreen` (web's single-ephemeral-chat case, so the feature isn't native-only).
- `WhyPanel`/`explain()`/`explainAttribute()` (Tier 4.8) turned out to be fully reusable as-is — no adaptation needed, confirming the "purely presentational, no data-fetching" design goal from when they were built.

**Also fixed while verifying this (pre-existing, not caused by this change):** the web bundle was completely broken — `openKleepDatabase.ts` imported `expo-sqlite` unconditionally (with only a runtime `Platform.OS === "web"` check to skip using it), but Metro resolves imports statically per bundle target, so the web build failed outright trying to resolve `expo-sqlite`'s wasm asset. Split into `openKleepDatabase.native.ts`/`.web.ts` (Metro's standard platform-suffix convention) so the web variant never imports `expo-sqlite` at all; added `moduleSuffixes` to `tsconfig.json` so `tsc` resolves the extensionless import too. Verified: `expo start --web` now bundles cleanly (549 modules, previously failed with an unresolved-import error) and serves the app; confirmed via a raw HTTP fetch of the bundle rather than a browser session, since this sandbox's Chromium/Electron setup can't run the RN DevTools Metro tries to install (unrelated, pre-existing sandbox limitation, not a code issue).

**Done when:**
- `list()` behaves identically on both store impls (network/tag/viewpoint_holder filters, empty store, no filter) ✅ — shared contract tests in `src/storage/__tests__/vectorStore.contract.ts`
- The screen renders and the why-panel flow works — **not verified in a live RN session** (no simulator/device in this sandbox); verified instead that `tsc`/the full Jest suite pass and that the web bundle actually builds and serves after the fix above, which is the same verification depth Tier 7.1's chat-list work got.

**Depends on:** #4/#6 (structured/vector stores), #13 (chat sessions, for the `App.tsx` state-machine pattern this reused).

---

## Suggested execution order

The dependency graph collapses into roughly three waves:

**Wave 1 (parallel, foundation):** #1, #2, #4
**Wave 2 (depends on Wave 1):** #3, #5, #6
**Wave 3 (depends on Waves 1–2):** #7, #8, #9, #10

Item #11 (OpenRouter + generic provider interface) landed alongside Wave 2 by request, ahead of its natural spot — it generalizes #1 rather than depending on a later wave. Item #12 (Android APK via GitHub Actions) landed the same way, right after #5 — it makes the chat surface installable rather than adding new product surface. Items #4 and #6 (persistence), #13 (chat sessions + list UI), #14 (model browser), and #15 (memory browser) landed together, by request, ahead of Wave 3 — persistence turned out to be the actual foundation the "usable" milestone was missing, not a later-wave nice-to-have, and the other two were natural follow-ons once it existed.

If we goal-mode the whole list, that's ~3–4 weeks of focused work at the pace we've been moving. After Wave 2, Kleep is actually usable — and as of #5's first pass + #11, it now technically is (single-screen, non-streaming, no persistence, needs your own API key). After Wave 3, it's a product.

See [`ROADMAP.md`](./ROADMAP.md) for the full long-term picture.
