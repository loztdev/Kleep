/**
 * Searchable model picker — replaces free-typing a model id in
 * `ConnectScreen.tsx`. OpenRouter's catalog is public (no key needed);
 * Claude's needs the key already typed into the connect form.
 */

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { listClaudeModels } from "../claude";
import type { LlmProviderKind, ModelInfo } from "../llm";
import { listOpenRouterModels } from "../llm/openrouter";
import { friendlyErrorMessage } from "./friendlyError";
import { ACCENT, BG, BORDER, ERROR, MUTED, SURFACE, TEXT } from "./theme";

interface ModelPickerModalProps {
  visible: boolean;
  kind: LlmProviderKind;
  apiKey: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

export function ModelPickerModal({ visible, kind, apiKey, onSelect, onClose }: ModelPickerModalProps) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) return;
    setModels(null);
    setError(null);
    setQuery("");

    if (kind === "claude" && !apiKey.trim()) {
      setError("Enter your API key above first — Claude's model list needs it.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    const fetchModels = kind === "claude" ? listClaudeModels(apiKey.trim()) : listOpenRouterModels();
    fetchModels
      .then((result) => {
        if (!cancelled) setModels(result);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, kind, apiKey]);

  const filtered = (models ?? []).filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q);
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Choose a model</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close-outline" size={24} color={TEXT} />
          </Pressable>
        </View>

        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search models..."
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {loading ? (
          <ActivityIndicator style={styles.center} color={MUTED} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No models match "{query}".</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={styles.rowId} numberOfLines={1}>
                  {item.id}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, paddingTop: 56 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "700", color: TEXT },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT,
  },
  center: { marginTop: 40 },
  error: { color: ERROR, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  empty: { color: MUTED, textAlign: "center", marginTop: 40 },
  list: { paddingHorizontal: 16, gap: 6, paddingBottom: 24 },
  row: {
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowLabel: { color: TEXT, fontSize: 15, fontWeight: "600" },
  rowId: { color: MUTED, fontSize: 12, marginTop: 2 },
});
