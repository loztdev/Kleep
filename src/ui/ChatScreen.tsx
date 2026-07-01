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
 * No persistence yet (Tier 6) — the conversation and everything the
 * memory pipeline learned from it are gone on reload. That's expected.
 */

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
  const scrollRef = useRef<ScrollView>(null);
  // `sending` (state) lags a render behind a tap, so a fast double-tap can
  // slip through before the button disables — this ref guard is synchronous.
  const sendingRef = useRef(false);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;

    const userTurn: Turn = { id: newId(), role: TurnRole.USER, content: text, index: engine.buffer.size() };
    engine.buffer.append(userTurn);
    setMessages((prev) => [...prev, userTurn]);
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
      setMessages((prev) => [...prev, assistantTurn]);

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
    } catch (err) {
      console.error("generateReply failed:", err);
      setError(friendlyErrorMessage(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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
            <View
              key={turn.id}
              style={[styles.bubble, turn.role === TurnRole.USER ? styles.bubbleUser : styles.bubbleAssistant]}
            >
              <Text style={turn.role === TurnRole.USER ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
                {turn.content}
              </Text>
            </View>
          ))
        )}
        {sending ? <ActivityIndicator style={styles.thinking} /> : null}
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={input}
          onChangeText={setInput}
          placeholder="Message Kleep..."
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  headerTitle: { fontSize: 20, fontWeight: "700" },
  disconnect: { color: "#888", fontSize: 13 },
  messageList: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { color: "#888", fontSize: 14, textAlign: "center", marginTop: 40 },
  bubble: { maxWidth: "85%", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#2563eb" },
  bubbleAssistant: { alignSelf: "flex-start", backgroundColor: "#f1f1f3" },
  bubbleTextUser: { color: "#fff", fontSize: 15 },
  bubbleTextAssistant: { color: "#111", fontSize: 15 },
  thinking: { marginTop: 4, alignSelf: "flex-start" },
  error: { color: "#dc2626", paddingHorizontal: 16, paddingBottom: 4, fontSize: 13 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddd",
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 15,
  },
  sendButton: { backgroundColor: "#2563eb", borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10 },
  sendButtonDisabled: { backgroundColor: "#a9c2f0" },
  sendButtonText: { color: "#fff", fontWeight: "700" },
});
