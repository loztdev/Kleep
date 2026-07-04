/**
 * Tier 5 #5 (first pass) — the mobile chat surface.
 *
 * Deliberately non-streaming for now: `sendMessage` (not `streamMessage`)
 * drives the reply. Streaming response bodies are unreliable across React
 * Native's `fetch` implementation (especially Android) without extra
 * polyfills — better to ship a reliable non-streaming v1 than a flaky
 * streaming one. `OpenRouterClient`/`ClaudeProvider` both already support
 * `streamMessage` for whenever that's worth revisiting.
 *
 * Per-message actions: an assistant reply can be regenerated or copied; a
 * user message can be edited. Both regenerate and edit are "branch"
 * operations in the sense that they discard everything after the target
 * turn and replay from there — the discarded suffix isn't kept around as
 * a switchable alternate branch, just dropped (see NEXT-10.md's Tier 12
 * note on the known gap: already-extracted facts from a discarded turn
 * currently linger in the shared memory stores). Both compute the new
 * reply *before* mutating the buffer, so a failed regenerate/edit leaves
 * the existing conversation untouched instead of needing a rollback.
 *
 * Persistence (Tier 6, native only — `sessionId`/`sessionStore` are `null`
 * on web, see `openKleepDatabase.ts`): every buffer mutation here is
 * mirrored into `ChatSessionStore` so the transcript survives a restart.
 * `structured`/`vector` are NOT per-chat — every session shares the same
 * continuous memory, only the transcript is per-session.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ConversationBuffer, TurnRole, type Turn } from "../conversation";
import type { LlmProvider, LlmProviderKind } from "../llm";
import { newId } from "../schema";
import type { ChatSessionStore, PromptStore, SavedPromptKind, StructuredStore, VectorStore } from "../storage";
import { DEFAULT_CACHE_SETTINGS, generateReply, type CacheSettings } from "./chatReply";
import { friendlyErrorMessage } from "./friendlyError";
import { buildMemoryEngine, syncSessionProgress } from "./memoryEngine";
import { PromptPickerModal } from "./PromptPickerModal";
import { ACCENT, BG, BORDER, ERROR, MUTED, SURFACE, TEXT } from "./theme";

interface ChatScreenProps {
  provider: LlmProvider;
  providerKind: LlmProviderKind;
  model?: string;
  structured: StructuredStore;
  vector: VectorStore;
  promptStore: PromptStore;
  /** Seeds a brand-new/ephemeral chat's system prompt; ignored once a session has its own stored value. */
  defaultSystemPrompt?: string;
  /** Seeds a brand-new/ephemeral chat's jailbreak prompt; same "ignored once stored" rule as `defaultSystemPrompt`. */
  defaultJailbreakPrompt?: string;
  /** App-wide caching preference set on `ConnectScreen`; defaults to real prompt caching on, response caching off. */
  cacheSettings?: CacheSettings;
  /** `null` on web — no persistence there, see `openKleepDatabase.ts`. */
  sessionId: string | null;
  sessionStore: ChatSessionStore | null;
  onDisconnect: () => void;
  onOpenMemory: () => void;
  /** Present only when there's a chat list to go back to (native). */
  onBack?: () => void;
}

export function ChatScreen({
  provider,
  providerKind,
  model,
  structured,
  vector,
  promptStore,
  defaultSystemPrompt,
  defaultJailbreakPrompt,
  cacheSettings = DEFAULT_CACHE_SETTINGS,
  sessionId,
  sessionStore,
  onDisconnect,
  onOpenMemory,
  onBack,
}: ChatScreenProps) {
  const { engine, providerMismatch, initialSystemPrompt, initialJailbreakPrompt } = useMemo(() => {
    const buffer =
      sessionId && sessionStore
        ? (() => {
            const loaded = sessionStore.loadSession(sessionId);
            return ConversationBuffer.fromPersisted(loaded.turns, {
              processedCount: loaded.processedCount,
              summarizedTurnIds: loaded.summarizedTurnIds,
            });
          })()
        : new ConversationBuffer();

    // A chat opened under a different provider/model than it was created
    // with (e.g. reconnected with a different backend) would otherwise
    // silently keep answering on the new one while the chat list still
    // shows the old metadata — flag it and correct the stored metadata to
    // match what's actually happening from here on.
    let mismatch = false;
    let systemPrompt = defaultSystemPrompt;
    let jailbreakPrompt = defaultJailbreakPrompt;
    if (sessionId && sessionStore) {
      const meta = sessionStore.getSession(sessionId);
      if (meta) {
        systemPrompt = meta.systemPrompt;
        jailbreakPrompt = meta.jailbreakPrompt;
        if (meta.providerKind !== providerKind || meta.model !== model) {
          mismatch = true;
          sessionStore.updateProviderMeta(sessionId, providerKind, model);
        }
      }
    }

    return {
      engine: buildMemoryEngine(provider, { structured, vector, buffer }),
      providerMismatch: mismatch,
      initialSystemPrompt: systemPrompt,
      initialJailbreakPrompt: jailbreakPrompt,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, structured, vector, sessionId, sessionStore]);
  const [messages, setMessages] = useState<Turn[]>(() => engine.buffer.all().slice());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [activeSystemPrompt, setActiveSystemPrompt] = useState<string | undefined>(initialSystemPrompt);
  const [activeJailbreakPrompt, setActiveJailbreakPrompt] = useState<string | undefined>(initialJailbreakPrompt);
  // One picker component instance, driven by which "slot" the user tapped to
  // open it — persona icon vs jailbreak icon. `null` means the modal is hidden.
  const [pickerKind, setPickerKind] = useState<SavedPromptKind | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // `sending` (state) lags a render behind a tap, so a fast double-tap can
  // slip through before any button disables — this ref guard is synchronous.
  const sendingRef = useRef(false);

  const scrollToEnd = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

  // Persist first, then mirror into `engine.buffer` only once the durable
  // write has actually succeeded — a failed write throws before the buffer
  // is touched, so the visible transcript can never run ahead of what's
  // saved (no rollback needed, since nothing was mutated yet).
  const persistAppend = (turn: Turn) => {
    if (sessionId && sessionStore) sessionStore.appendTurn(sessionId, turn, Date.now());
  };
  const persistReplaceFrom = (turnId: string, newTurns: readonly Turn[]) => {
    if (sessionId && sessionStore) sessionStore.replaceFrom(sessionId, turnId, newTurns, Date.now());
  };

  const handleSelectSystemPrompt = (content: string) => {
    try {
      if (sessionId && sessionStore) sessionStore.updateSystemPrompt(sessionId, content, Date.now());
      setActiveSystemPrompt(content);
    } catch (err) {
      console.error("updateSystemPrompt failed:", err);
      setError(friendlyErrorMessage(err));
    }
  };

  const handleSelectJailbreakPrompt = (content: string) => {
    try {
      if (sessionId && sessionStore) sessionStore.updateJailbreakPrompt(sessionId, content, Date.now());
      setActiveJailbreakPrompt(content);
    } catch (err) {
      console.error("updateJailbreakPrompt failed:", err);
      setError(friendlyErrorMessage(err));
    }
  };

  const tickMemoryPipeline = async () => {
    // Memory-pipeline ticks are best-effort: a flaky extraction/summary
    // call shouldn't take the chat down. Log and move on.
    try {
      await engine.autoRetain.tick();
    } catch (err) {
      console.warn("AutoRetainEngine.tick failed:", err);
    }
    try {
      await engine.rollingSummarizer.tick();
    } catch (err) {
      console.warn("RollingSummarizer.tick failed:", err);
    }
    if (sessionId && sessionStore) syncSessionProgress(sessionStore, sessionId, engine.buffer);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setSending(true);

    try {
      const userTurn: Turn = { id: newId(), role: TurnRole.USER, content: text, index: engine.buffer.size() };
      persistAppend(userTurn);
      engine.buffer.append(userTurn);
      setMessages(engine.buffer.all().slice());
      setInput("");

      const replyText = await generateReply(
        provider,
        engine.buffer.liveTurns(),
        activeSystemPrompt,
        cacheSettings,
        activeJailbreakPrompt,
      );
      const assistantTurn: Turn = {
        id: newId(),
        role: TurnRole.ASSISTANT,
        content: replyText,
        index: engine.buffer.size(),
      };
      persistAppend(assistantTurn);
      engine.buffer.append(assistantTurn);
      setMessages(engine.buffer.all().slice());
      await tickMemoryPipeline();
    } catch (err) {
      console.error("generateReply failed:", err);
      setError(friendlyErrorMessage(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
      scrollToEnd();
    }
  };

  const handleRegenerate = async (turnId: string) => {
    if (sendingRef.current) return;
    const contextTurns = engine.buffer.contextBefore(turnId);
    const target = engine.buffer.get(turnId);
    if (!target) return;
    sendingRef.current = true;
    setError(null);
    setSending(true);

    try {
      // Compute the new reply from the context *before* this turn first,
      // then persist the truncate+append as one transaction, and only
      // mirror it into `engine.buffer` once that succeeds — a failure at
      // any step leaves the existing reply in place with nothing to roll
      // back, instead of the buffer running ahead of what's saved.
      const replyText = await generateReply(
        provider,
        contextTurns,
        activeSystemPrompt,
        cacheSettings,
        activeJailbreakPrompt,
      );
      const assistantTurn: Turn = {
        id: newId(),
        role: TurnRole.ASSISTANT,
        content: replyText,
        index: target.index,
      };
      persistReplaceFrom(turnId, [assistantTurn]);
      engine.buffer.truncateFrom(turnId);
      engine.buffer.append(assistantTurn);
      setMessages(engine.buffer.all().slice());
      await tickMemoryPipeline();
    } catch (err) {
      console.error("regenerate failed:", err);
      setError(friendlyErrorMessage(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
      scrollToEnd();
    }
  };

  const startEdit = (turn: Turn) => {
    if (sendingRef.current) return;
    setEditingTurnId(turn.id);
    setEditingText(turn.content);
  };

  const cancelEdit = () => {
    setEditingTurnId(null);
    setEditingText("");
  };

  const submitEdit = async (turnId: string) => {
    const text = editingText.trim();
    if (!text || sendingRef.current) return;
    const priorTurns = engine.buffer.contextBefore(turnId);
    const target = engine.buffer.get(turnId);
    if (!target) return;
    sendingRef.current = true;
    setError(null);
    setSending(true);

    try {
      const editedTurn: Turn = { id: newId(), role: TurnRole.USER, content: text, index: target.index };
      const replyText = await generateReply(
        provider,
        [...priorTurns, editedTurn],
        activeSystemPrompt,
        cacheSettings,
        activeJailbreakPrompt,
      );
      const assistantTurn: Turn = {
        id: newId(),
        role: TurnRole.ASSISTANT,
        content: replyText,
        index: target.index + 1,
      };
      persistReplaceFrom(turnId, [editedTurn, assistantTurn]);
      engine.buffer.truncateFrom(turnId);
      engine.buffer.append(editedTurn);
      engine.buffer.append(assistantTurn);
      setMessages(engine.buffer.all().slice());
      setEditingTurnId(null);
      setEditingText("");
      await tickMemoryPipeline();
    } catch (err) {
      console.error("edit-resend failed:", err);
      setError(friendlyErrorMessage(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
      scrollToEnd();
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch (err) {
      console.warn("Copy to clipboard failed:", err);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to chats">
              <Ionicons name="chevron-back-outline" size={22} color={TEXT} />
            </Pressable>
          ) : null}
          <Text style={styles.headerTitle}>Kleep</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => setPickerKind("jailbreak")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Choose jailbreak prompt"
          >
            <Ionicons
              name={activeJailbreakPrompt ? "flame" : "flame-outline"}
              size={20}
              color={activeJailbreakPrompt ? ACCENT : MUTED}
            />
          </Pressable>
          <Pressable
            onPress={() => setPickerKind("persona")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Choose system prompt"
          >
            <Ionicons name="chatbox-ellipses-outline" size={20} color={MUTED} />
          </Pressable>
          <Pressable
            onPress={onOpenMemory}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open memory browser"
          >
            <Ionicons name="library-outline" size={20} color={MUTED} />
          </Pressable>
          <Pressable onPress={onDisconnect}>
            <Text style={styles.disconnect}>Disconnect</Text>
          </Pressable>
        </View>
      </View>

      {providerMismatch ? (
        <Text style={styles.providerNotice}>
          This chat was started on a different provider/model — continuing here on {providerKind}
          {model ? ` · ${model}` : ""}.
        </Text>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <Text style={styles.empty}>
            Say something below — Kleep will reply and start remembering names, places, and facts as you go.
          </Text>
        ) : (
          messages.map((turn) => (
            <MessageBubble
              key={turn.id}
              turn={turn}
              disabled={sending}
              isEditing={editingTurnId === turn.id}
              editingText={editingText}
              onEditingTextChange={setEditingText}
              onStartEdit={() => startEdit(turn)}
              onCancelEdit={cancelEdit}
              onSubmitEdit={() => submitEdit(turn.id)}
              onRegenerate={() => handleRegenerate(turn.id)}
              onCopy={() => handleCopy(turn.content)}
            />
          ))
        )}
        {sending ? <ActivityIndicator style={styles.thinking} color="#8e8e93" /> : null}
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={input}
          onChangeText={setInput}
          placeholder="Message Kleep..."
          placeholderTextColor="#8e8e93"
          multiline
          editable={!sending}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>

      <PromptPickerModal
        visible={pickerKind !== null}
        kind={pickerKind ?? "persona"}
        promptStore={promptStore}
        onSelect={pickerKind === "jailbreak" ? handleSelectJailbreakPrompt : handleSelectSystemPrompt}
        onClose={() => setPickerKind(null)}
      />
    </KeyboardAvoidingView>
  );
}

interface MessageBubbleProps {
  turn: Turn;
  disabled: boolean;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (text: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
}

function MessageBubble({
  turn,
  disabled,
  isEditing,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
  onCopy,
}: MessageBubbleProps) {
  const isUser = turn.role === TurnRole.USER;
  if (turn.role !== TurnRole.USER && turn.role !== TurnRole.ASSISTANT) return null;

  return (
    <View style={isUser ? styles.bubbleWrapUser : styles.bubbleWrapAssistant}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {isEditing ? (
          <TextInput
            style={styles.editInput}
            value={editingText}
            onChangeText={onEditingTextChange}
            multiline
            autoFocus
            placeholderTextColor={MUTED}
          />
        ) : (
          <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>{turn.content}</Text>
        )}
      </View>

      {isEditing ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={onCancelEdit}
            style={styles.iconButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cancel edit"
          >
            <Ionicons name="close-outline" size={18} color={MUTED} />
          </Pressable>
          <Pressable
            onPress={onSubmitEdit}
            style={styles.iconButton}
            hitSlop={8}
            disabled={!editingText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Save edit and resend"
          >
            <Ionicons name="checkmark-outline" size={18} color={editingText.trim() ? "#fff" : "#555"} />
          </Pressable>
        </View>
      ) : isUser ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={onStartEdit}
            style={styles.iconButton}
            hitSlop={8}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Edit message"
          >
            <Ionicons name="pencil-outline" size={16} color={MUTED} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={onCopy}
            style={styles.iconButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Copy reply"
          >
            <Ionicons name="copy-outline" size={16} color={MUTED} />
          </Pressable>
          <Pressable
            onPress={onRegenerate}
            style={styles.iconButton}
            hitSlop={8}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Regenerate reply"
          >
            <Ionicons name="refresh-outline" size={16} color={MUTED} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  headerTitle: { fontSize: 20, fontWeight: "700", color: TEXT },
  providerNotice: {
    color: MUTED,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: SURFACE,
  },
  disconnect: { color: MUTED, fontSize: 13 },
  messageList: { padding: 16, gap: 4, flexGrow: 1 },
  empty: { color: MUTED, fontSize: 14, textAlign: "center", marginTop: 40 },
  bubbleWrapUser: { alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "85%", marginBottom: 10 },
  bubbleWrapAssistant: { alignSelf: "flex-start", alignItems: "flex-start", maxWidth: "85%", marginBottom: 10 },
  bubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: ACCENT },
  bubbleAssistant: { backgroundColor: SURFACE },
  bubbleTextUser: { color: "#fff", fontSize: 15 },
  bubbleTextAssistant: { color: TEXT, fontSize: 15 },
  editInput: { color: TEXT, fontSize: 15, minWidth: 160, padding: 0 },
  actionsRow: { flexDirection: "row", gap: 4, marginTop: 4 },
  iconButton: { padding: 4 },
  thinking: { marginTop: 4, alignSelf: "flex-start" },
  error: { color: ERROR, paddingHorizontal: 16, paddingBottom: 4, fontSize: 13 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 15,
    color: TEXT,
  },
  sendButton: { backgroundColor: ACCENT, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10 },
  sendButtonDisabled: { backgroundColor: "#1e3a6b" },
  sendButtonText: { color: "#fff", fontWeight: "700" },
});
