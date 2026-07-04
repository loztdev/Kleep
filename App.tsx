import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { buildLlmProvider, type LlmProvider, type LlmProviderKind } from "./src/llm";
import { clearApiKey, loadActiveProvider, loadApiKey } from "./src/llm/secureKeyStore";
import {
  ChatSessionStore,
  InMemoryPromptStore,
  InMemoryStructuredStore,
  InMemoryVectorStore,
  SqlitePromptStore,
  SqliteStructuredStore,
  SqliteVectorStore,
  type PromptStore,
  type StructuredStore,
  type VectorStore,
} from "./src/storage";
import type { SqlDatabase } from "./src/storage/sql/types";
import { openKleepDatabase } from "./src/storage/sql/openKleepDatabase";
import { DEFAULT_CACHE_SETTINGS, type CacheSettings } from "./src/ui/chatReply";
import { ChatListScreen } from "./src/ui/ChatListScreen";
import { ChatScreen } from "./src/ui/ChatScreen";
import { ConnectScreen } from "./src/ui/ConnectScreen";
import { MemoryBrowserScreen } from "./src/ui/MemoryBrowserScreen";
import { BG, MUTED } from "./src/ui/theme";

/**
 * `structured`/`vector` are ONE continuous memory shared by every chat
 * session — only the transcript is per-session (see `ChatScreen.tsx`,
 * `ChatSessionStore`). `sessionStore` is `null` on web (no persistence —
 * see `openKleepDatabase.ts`), which is also how the app knows to skip
 * the chat list and go straight to a single ephemeral chat. `promptStore`
 * is always available (even on web) — saved prompts don't need native
 * persistence to be useful for the length of a session, same as
 * `structured`/`vector`. `defaultSystemPrompt` seeds new chats' system
 * prompt the same way `model` seeds their model (Tier 7.6).
 */
interface ConnectedContext {
  provider: LlmProvider;
  providerKind: LlmProviderKind;
  model?: string;
  defaultSystemPrompt?: string;
  defaultJailbreakPrompt?: string;
  cacheSettings: CacheSettings;
  structured: StructuredStore;
  vector: VectorStore;
  promptStore: PromptStore;
  sessionStore: ChatSessionStore | null;
}

type AppState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "chatList"; ctx: ConnectedContext }
  | { status: "chat"; ctx: ConnectedContext; sessionId: string | null }
  | { status: "memory"; ctx: ConnectedContext; returnTo: AppState };

function buildConnectedContext(
  db: SqlDatabase | null,
  promptStore: PromptStore,
  provider: LlmProvider,
  providerKind: LlmProviderKind,
  model?: string,
  defaultSystemPrompt?: string,
  cacheSettings: CacheSettings = DEFAULT_CACHE_SETTINGS,
  defaultJailbreakPrompt?: string,
): ConnectedContext {
  return {
    provider,
    providerKind,
    ...(model ? { model } : {}),
    ...(defaultSystemPrompt ? { defaultSystemPrompt } : {}),
    ...(defaultJailbreakPrompt ? { defaultJailbreakPrompt } : {}),
    cacheSettings,
    structured: db ? new SqliteStructuredStore(db) : new InMemoryStructuredStore(),
    vector: db ? new SqliteVectorStore(db) : new InMemoryVectorStore(),
    promptStore,
    sessionStore: db ? new ChatSessionStore(db) : null,
  };
}

/** Entry point after connecting: the chat list on native, a single ephemeral chat on web. */
function initialConnectedState(ctx: ConnectedContext): AppState {
  return ctx.sessionStore ? { status: "chatList", ctx } : { status: "chat", ctx, sessionId: null };
}

export default function App() {
  const [state, setState] = useState<AppState>({ status: "loading" });
  // Opened once for the app's lifetime, independent of connecting — saved
  // prompts (and the chat list) need this before any provider is chosen.
  const [db] = useState(() => openKleepDatabase());
  const promptStore = useMemo<PromptStore>(
    () => (db ? new SqlitePromptStore(db) : new InMemoryPromptStore()),
    [db],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kind = await loadActiveProvider();
        const apiKey = kind ? await loadApiKey(kind) : null;
        if (cancelled) return;
        if (kind && apiKey) {
          const provider = buildLlmProvider({ kind, apiKey });
          setState(initialConnectedState(buildConnectedContext(db, promptStore, provider, kind)));
        } else {
          setState({ status: "disconnected" });
        }
      } catch (err) {
        console.error("Failed to load stored provider:", err);
        if (!cancelled) setState({ status: "disconnected" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = useCallback(() => {
    // Fire-and-forget: the UI shouldn't wait on SecureStore to clear. Only
    // the saved API key/provider choice is cleared — the on-device memory
    // (chats, world bible, lore) is untouched; reconnecting picks it back
    // up, same as it would with any other provider.
    loadActiveProvider()
      .then((kind) => kind && clearApiKey(kind))
      .catch((err) => console.warn("Failed to clear stored API key:", err));
    setState({ status: "disconnected" });
  }, []);

  const handleConnected = useCallback(
    (
      provider: LlmProvider,
      kind: LlmProviderKind,
      model?: string,
      defaultSystemPrompt?: string,
      cacheSettings?: CacheSettings,
      defaultJailbreakPrompt?: string,
    ) => {
      setState(
        initialConnectedState(
          buildConnectedContext(
            db,
            promptStore,
            provider,
            kind,
            model,
            defaultSystemPrompt,
            cacheSettings,
            defaultJailbreakPrompt,
          ),
        ),
      );
    },
    [db, promptStore],
  );

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={MUTED} />
        <StatusBar style="light" />
      </View>
    );
  }

  if (state.status === "disconnected") {
    return (
      <View style={styles.flex}>
        <ConnectScreen promptStore={promptStore} onConnected={handleConnected} />
        <StatusBar style="light" />
      </View>
    );
  }

  if (state.status === "chatList") {
    return (
      <ChatListBody
        ctx={state.ctx}
        onOpenChat={(sessionId) => setState({ status: "chat", ctx: state.ctx, sessionId })}
        onDisconnect={handleDisconnect}
        onOpenMemory={() => setState({ status: "memory", ctx: state.ctx, returnTo: state })}
      />
    );
  }

  if (state.status === "memory") {
    return (
      <View style={styles.flex}>
        <MemoryBrowserScreen
          structured={state.ctx.structured}
          vector={state.ctx.vector}
          onClose={() => setState(state.returnTo)}
        />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ChatScreen
        provider={state.ctx.provider}
        providerKind={state.ctx.providerKind}
        model={state.ctx.model}
        structured={state.ctx.structured}
        vector={state.ctx.vector}
        promptStore={state.ctx.promptStore}
        defaultSystemPrompt={state.ctx.defaultSystemPrompt}
        defaultJailbreakPrompt={state.ctx.defaultJailbreakPrompt}
        cacheSettings={state.ctx.cacheSettings}
        sessionId={state.sessionId}
        sessionStore={state.ctx.sessionStore}
        onDisconnect={handleDisconnect}
        onOpenMemory={() => setState({ status: "memory", ctx: state.ctx, returnTo: state })}
        {...(state.ctx.sessionStore
          ? { onBack: () => setState({ status: "chatList", ctx: state.ctx }) }
          : {})}
      />
      <StatusBar style="light" />
    </View>
  );
}

/** Small wrapper so `ChatListScreen` can re-read `listSessions()` after create/rename/delete without lifting more state into `App`. */
function ChatListBody({
  ctx,
  onOpenChat,
  onDisconnect,
  onOpenMemory,
}: {
  ctx: ConnectedContext;
  onOpenChat: (sessionId: string) => void;
  onDisconnect: () => void;
  onOpenMemory: () => void;
}) {
  const sessionStore = ctx.sessionStore;
  const [refreshTick, forceRefresh] = useState(0);
  const sessions = useMemo(
    () => sessionStore?.listSessions() ?? [],
    [sessionStore, refreshTick],
  );
  if (!sessionStore) return null; // unreachable — chatList is only entered when sessionStore exists

  const handleNewChat = () => {
    const session = sessionStore.createSession({
      id: newSessionId(),
      title: "New chat",
      providerKind: ctx.providerKind,
      ...(ctx.model ? { model: ctx.model } : {}),
      ...(ctx.defaultSystemPrompt ? { systemPrompt: ctx.defaultSystemPrompt } : {}),
      ...(ctx.defaultJailbreakPrompt ? { jailbreakPrompt: ctx.defaultJailbreakPrompt } : {}),
      now: Date.now(),
    });
    onOpenChat(session.id);
  };

  const handleRename = (sessionId: string, title: string) => {
    sessionStore.renameSession(sessionId, title, Date.now());
    forceRefresh((n) => n + 1);
  };

  const handleDelete = (sessionId: string) => {
    sessionStore.deleteSession(sessionId);
    forceRefresh((n) => n + 1);
  };

  return (
    <View style={styles.flex}>
      <ChatListScreen
        sessions={sessions}
        onOpenChat={onOpenChat}
        onNewChat={handleNewChat}
        onRenameChat={handleRename}
        onDeleteChat={handleDelete}
        onDisconnect={onDisconnect}
        onOpenMemory={onOpenMemory}
      />
      <StatusBar style="light" />
    </View>
  );
}

function newSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  center: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
});
