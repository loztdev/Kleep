/**
 * Tier 7's "Chats" list (native only — see `App.tsx`, `openKleepDatabase`)
 * sitting between Connect and an individual chat. Every session shares
 * the same underlying memory (World Bible, lore, facts) — only the
 * conversation transcript is per-session — so this screen is purely
 * about which transcript you're looking at, not separate "worlds".
 */

import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ChatSessionMeta } from "../storage";
import { ACCENT, BG, BORDER, MUTED, SURFACE, TEXT } from "./theme";

interface ChatListScreenProps {
  sessions: ChatSessionMeta[];
  onOpenChat: (sessionId: string) => void;
  onNewChat: () => void;
  onRenameChat: (sessionId: string, title: string) => void;
  onDeleteChat: (sessionId: string) => void;
  onDisconnect: () => void;
}

export function ChatListScreen({
  sessions,
  onOpenChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
  onDisconnect,
}: ChatListScreenProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startRename = (session: ChatSessionMeta) => {
    setRenamingId(session.id);
    setRenameText(session.title);
  };

  const submitRename = () => {
    const title = renameText.trim();
    if (renamingId && title) onRenameChat(renamingId, title);
    setRenamingId(null);
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <Pressable onPress={onDisconnect}>
          <Text style={styles.disconnect}>Disconnect</Text>
        </Pressable>
      </View>

      <Pressable style={styles.newChatButton} onPress={onNewChat}>
        <Ionicons name="add-outline" size={18} color="#fff" />
        <Text style={styles.newChatButtonText}>New chat</Text>
      </Pressable>

      {sessions.length === 0 ? (
        <Text style={styles.empty}>No chats yet — start one above.</Text>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.row}>
              {renamingId === item.id ? (
                <>
                  <TextInput
                    style={styles.renameInput}
                    value={renameText}
                    onChangeText={setRenameText}
                    autoFocus
                    placeholderTextColor={MUTED}
                  />
                  <Pressable
                    onPress={() => setRenamingId(null)}
                    style={styles.iconButton}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel rename"
                  >
                    <Ionicons name="close-outline" size={18} color={MUTED} />
                  </Pressable>
                  <Pressable
                    onPress={submitRename}
                    style={styles.iconButton}
                    hitSlop={8}
                    disabled={!renameText.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Save chat name"
                  >
                    <Ionicons name="checkmark-outline" size={18} color={renameText.trim() ? "#fff" : "#555"} />
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable style={styles.rowContent} onPress={() => onOpenChat(item.id)}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowSubtitle}>
                      {item.providerKind}
                      {item.model ? ` · ${item.model}` : ""} · {formatRelativeTime(item.updatedAt)}
                    </Text>
                  </Pressable>
                  {confirmDeleteId === item.id ? (
                    <>
                      <Pressable
                        onPress={() => setConfirmDeleteId(null)}
                        style={styles.iconButton}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel delete"
                      >
                        <Ionicons name="close-outline" size={18} color={MUTED} />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          onDeleteChat(item.id);
                          setConfirmDeleteId(null);
                        }}
                        style={styles.iconButton}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Confirm delete chat"
                      >
                        <Ionicons name="checkmark-outline" size={18} color="#ff453a" />
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => startRename(item)}
                        style={styles.iconButton}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Rename chat"
                      >
                        <Ionicons name="pencil-outline" size={16} color={MUTED} />
                      </Pressable>
                      <Pressable
                        onPress={() => setConfirmDeleteId(item.id)}
                        style={styles.iconButton}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete chat"
                      >
                        <Ionicons name="trash-outline" size={16} color={MUTED} />
                      </Pressable>
                    </>
                  )}
                </>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

function formatRelativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: TEXT },
  disconnect: { color: MUTED, fontSize: 13 },
  newChatButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 12,
    margin: 16,
  },
  newChatButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  empty: { color: MUTED, fontSize: 14, textAlign: "center", marginTop: 40 },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  rowContent: { flex: 1 },
  rowTitle: { color: TEXT, fontSize: 15, fontWeight: "600" },
  rowSubtitle: { color: MUTED, fontSize: 12, marginTop: 2 },
  renameInput: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingVertical: 2,
  },
  iconButton: { padding: 6 },
});
