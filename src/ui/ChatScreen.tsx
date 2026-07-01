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
 * turn and replay from there — this app has no persistence yet (Tier 6),
 * so the discarded suffix isn't kept around as a switchable alternate
 * branch, just dropped. Both compute the new reply *before* mutating the
 * buffer, so a failed regenerate/edit leaves the existing conversation
 * untouched instead of needing a rollback.
 *
 * No persistence yet (Tier 6) — the conversation and everything the
 * memory pipeline learned from it are gone on reload. That's expected.
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
import { TurnRole, type Turn } from "../conversation";
import type { LlmProvider } from "../llm";
import { newId } from "../schema";
import { generateReply } from "./chatReply";
import { buildMemoryEngine } from "./memoryEngine";

interface ChatScreenProps {
  provider: LlmProvider;
  onDisconnect: () => void;
}

export function ChatScreen({ provider, onDisconnect }: ChatScreenProps) {
  const engine = useMemo(() => buildMemoryEngine(provider), [provider]);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  // `sending` (state) lags a render behind a tap, so a fast double-tap can
  // slip through before any button disables — this ref guard is synchronous.
  const sendingRef = useRef(false);

  const scrollToEnd = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

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
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;

    const userTurn: Turn = { id: newId(), role: TurnRole.USER, content: text, index: engine.buffer.size() };
    engine.buffer.append(userTurn);
    setMessages(engine.buffer.all().slice());
    setInput("");
    setError(null);
    setSending(true);

    try {
      const replyText = await generateReply(provider, engine.buffer.liveTurns());
      const assistantTurn: Turn = {
        id: newId(),
        role: TurnRole.ASSISTANT,
        content: replyText,
        index: engine.buffer.size(),
      };
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
    if (!engine.buffer.get(turnId)) return;
    sendingRef.current = true;
    setError(null);
    setSending(true);

    try {
      // Compute the new reply from the context *before* this turn first —
      // only commit (truncate + append) once it succeeds, so a failure
      // leaves the existing reply in place instead of needing a rollback.
      const replyText = await generateReply(provider, contextTurns);
      engine.buffer.truncateFrom(turnId);
      const assistantTurn: Turn = {
        id: newId(),
        role: TurnRole.ASSISTANT,
        content: replyText,
        index: engine.buffer.size(),
      };
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
      const replyText = await generateReply(provider, [...priorTurns, editedTurn]);
      engine.buffer.truncateFrom(turnId);
      engine.buffer.append(editedTurn);
      const assistantTurn: Turn = {
        id: newId(),
        role: TurnRole.ASSISTANT,
        content: replyText,
        index: engine.buffer.size(),
      };
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
        <Text style={styles.headerTitle}>Kleep</Text>
        <Pressable onPress={onDisconnect}>
          <Text style={styles.disconnect}>Disconnect</Text>
        </Pressable>
      </View>

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
            placeholderTextColor="#8e8e93"
          />
        ) : (
          <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>{turn.content}</Text>
        )}
      </View>

      {isEditing ? (
        <View style={styles.actionsRow}>
          <Pressable onPress={onCancelEdit} style={styles.iconButton} hitSlop={8}>
            <Ionicons name="close-outline" size={18} color="#8e8e93" />
          </Pressable>
          <Pressable onPress={onSubmitEdit} style={styles.iconButton} hitSlop={8} disabled={!editingText.trim()}>
            <Ionicons name="checkmark-outline" size={18} color={editingText.trim() ? "#fff" : "#555"} />
          </Pressable>
        </View>
      ) : isUser ? (
        <View style={styles.actionsRow}>
          <Pressable onPress={onStartEdit} style={styles.iconButton} hitSlop={8} disabled={disabled}>
            <Ionicons name="pencil-outline" size={16} color="#8e8e93" />
          </Pressable>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <Pressable onPress={onCopy} style={styles.iconButton} hitSlop={8}>
            <Ionicons name="copy-outline" size={16} color="#8e8e93" />
          </Pressable>
          <Pressable onPress={onRegenerate} style={styles.iconButton} hitSlop={8} disabled={disabled}>
            <Ionicons name="refresh-outline" size={16} color="#8e8e93" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * Low-level failures (a bare `fetch` rejection reads as "Failed to
 * fetch", a DNS/TLS error as something even less helpful) get a plain-
 * language message instead. Errors this app itself throws with a
 * specific, actionable message (e.g. "no model specified — pass
 * `model`...") are passed through as-is.
 */
function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/fetch|network/i.test(raw)) {
    return "Couldn't reach the model provider. Check your connection and try again.";
  }
  return raw || "Couldn't get a reply. Check your connection and try again.";
}

const BG = "#000000";
const SURFACE = "#1c1c1e";
const BORDER = "#2c2c2e";
const TEXT = "#ececec";
const MUTED = "#8e8e93";
const ACCENT = "#2563eb";

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
  headerTitle: { fontSize: 20, fontWeight: "700", color: TEXT },
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
  error: { color: "#ff453a", paddingHorizontal: 16, paddingBottom: 4, fontSize: 13 },
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
