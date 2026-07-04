/**
 * Tier 7.6 — system prompt picker. Three tabs:
 *
 * - "Personas" — the user's own persona prompts (`SavedPromptKind: 'persona'`)
 * - "Jailbreaks" — the user's own jailbreak prompts (`SavedPromptKind: 'jailbreak'`)
 * - "Library" — the community "awesome-chatgpt-prompts" dataset, fetched
 *   live, no auth needed. Library saves default to whichever kind the
 *   picker was opened for.
 *
 * Both saved-kind tabs let a row be *moved* to the other kind (the swap
 * icon) — one flat table under the hood, two views on top, so promoting a
 * persona to a jailbreak (or vice versa) keeps its title/content intact.
 *
 * `kind` decides the initial tab and library-save target only — the user
 * can freely flip tabs after opening. Used both at connect-time and per-chat
 * (`ChatScreen.tsx`) with two instances, one per kind.
 */

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { listPromptLibrary, type PromptLibraryEntry } from "../prompts";
import { newId } from "../schema";
import type { PromptStore, SavedPrompt, SavedPromptKind } from "../storage";
import { friendlyErrorMessage } from "./friendlyError";
import { ACCENT, BG, BORDER, ERROR, MUTED, SURFACE, TEXT } from "./theme";

interface PromptPickerModalProps {
  visible: boolean;
  promptStore: PromptStore;
  /** Which kind this picker is choosing for — drives the initial tab, the
   * "New prompt" default kind, and where library saves land. */
  kind: SavedPromptKind;
  onSelect: (content: string) => void;
  onClose: () => void;
}

type Tab = "persona" | "jailbreak" | "library";

const TAB_LABELS: Record<Exclude<Tab, "library">, string> = {
  persona: "Personas",
  jailbreak: "Jailbreaks",
};

const OTHER_KIND: Record<SavedPromptKind, SavedPromptKind> = {
  persona: "jailbreak",
  jailbreak: "persona",
};

export function PromptPickerModal({ visible, promptStore, kind, onSelect, onClose }: PromptPickerModalProps) {
  const [tab, setTab] = useState<Tab>(kind);
  const [query, setQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);

  const [libraryEntries, setLibraryEntries] = useState<PromptLibraryEntry[] | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTab(kind);
    setQuery("");
    setCreating(false);
    setEditingId(null);
    setConfirmDeleteId(null);
    setSavedPrompts(promptStore.list());

    let cancelled = false;
    const controller = new AbortController();
    setLibraryEntries(null);
    setLibraryError(null);
    setLibraryLoading(true);
    listPromptLibrary(fetch, controller.signal)
      .then((entries) => {
        if (!cancelled) setLibraryEntries(entries);
      })
      .catch((err) => {
        if (!cancelled) setLibraryError(friendlyErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, promptStore, kind]);

  useEffect(() => {
    setSavedPrompts(promptStore.list());
  }, [promptStore, refreshTick]);

  const refresh = () => setRefreshTick((n) => n + 1);

  const startCreate = () => {
    setEditingId(null);
    setDraftTitle("");
    setDraftContent("");
    setCreating(true);
  };

  const startEdit = (prompt: SavedPrompt) => {
    setCreating(false);
    setEditingId(prompt.id);
    setDraftTitle(prompt.title);
    setDraftContent(prompt.content);
  };

  const cancelDraft = () => {
    setCreating(false);
    setEditingId(null);
  };

  // Drafts always save into whichever saved-kind tab is currently visible so
  // the "New prompt" button on the Jailbreaks tab creates a jailbreak, not a
  // persona. Falling back to the picker's `kind` prop covers the Library-tab
  // case where `tab === 'library'` (which shouldn't reach here in practice,
  // since the "New prompt" button is hidden there).
  const draftKind: SavedPromptKind = tab === "library" ? kind : (tab as SavedPromptKind);

  const submitDraft = () => {
    const title = draftTitle.trim();
    const content = draftContent.trim();
    if (!title || !content) return;
    if (editingId) {
      promptStore.update(editingId, { title, content }, Date.now());
    } else {
      promptStore.create({ id: newId(), title, content, kind: draftKind, now: Date.now() });
    }
    setCreating(false);
    setEditingId(null);
    refresh();
  };

  const deletePrompt = (id: string) => {
    promptStore.delete(id);
    setConfirmDeleteId(null);
    refresh();
  };

  const moveKind = (prompt: SavedPrompt) => {
    promptStore.setKind(prompt.id, OTHER_KIND[prompt.kind], Date.now());
    refresh();
  };

  // Keyed by title+content+kind (not id — library entries and saved prompts
  // have unrelated id schemes) so a library row's "saved" checkmark reflects
  // the *current* saved list for the tab's kind — same content saved as
  // persona shouldn't mark the jailbreak-tab row as already saved and vice
  // versa (users may want the same text in both roles).
  const promptKey = (title: string, content: string, k: SavedPromptKind) => `${k}::${title}::${content}`;
  // Library saves land in the picker's originating `kind` — the "which slot
  // was I opened for" — not whichever tab the user happens to be on.
  const savedKeysForLibrary = new Set(
    savedPrompts.filter((p) => p.kind === kind).map((p) => promptKey(p.title, p.content, kind)),
  );

  const saveLibraryEntry = (entry: PromptLibraryEntry) => {
    if (savedKeysForLibrary.has(promptKey(entry.title, entry.content, kind))) return;
    promptStore.create({ id: newId(), title: entry.title, content: entry.content, kind, now: Date.now() });
    refresh();
  };

  const q = query.trim().toLowerCase();
  const savedForActiveTab =
    tab === "library" ? [] : savedPrompts.filter((p) => p.kind === (tab as SavedPromptKind));
  const filteredSaved = savedForActiveTab.filter(
    (p) => !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q),
  );
  const filteredLibrary = (libraryEntries ?? []).filter(
    (e) => !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q),
  );

  const showingDraft = creating || editingId !== null;
  const personaCount = savedPrompts.filter((p) => p.kind === "persona").length;
  const jailbreakCount = savedPrompts.filter((p) => p.kind === "jailbreak").length;
  const title = kind === "jailbreak" ? "Jailbreak prompt" : "System prompt";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close-outline" size={24} color={TEXT} />
          </Pressable>
        </View>

        {showingDraft ? (
          <ScrollView contentContainerStyle={styles.draftBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.titleInput}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder={draftKind === "jailbreak" ? "e.g. Uncensored writer" : "e.g. Terse assistant"}
              placeholderTextColor={MUTED}
              autoFocus
            />
            <Text style={styles.fieldLabel}>
              {draftKind === "jailbreak" ? "Jailbreak prompt" : "Persona prompt"}
            </Text>
            <TextInput
              style={styles.contentInput}
              value={draftContent}
              onChangeText={setDraftContent}
              placeholder="You are..."
              placeholderTextColor={MUTED}
              multiline
            />
            <View style={styles.draftActions}>
              <Pressable style={styles.secondaryButton} onPress={cancelDraft}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, (!draftTitle.trim() || !draftContent.trim()) && styles.primaryButtonDisabled]}
                onPress={submitDraft}
                disabled={!draftTitle.trim() || !draftContent.trim()}
              >
                <Text style={styles.primaryButtonText}>{editingId ? "Save changes" : "Save prompt"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <>
            <View style={styles.tabs}>
              <Pressable style={[styles.tab, tab === "persona" && styles.tabActive]} onPress={() => setTab("persona")}>
                <Text style={[styles.tabText, tab === "persona" && styles.tabTextActive]}>
                  {TAB_LABELS.persona} ({personaCount})
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, tab === "jailbreak" && styles.tabActive]}
                onPress={() => setTab("jailbreak")}
              >
                <Text style={[styles.tabText, tab === "jailbreak" && styles.tabTextActive]}>
                  {TAB_LABELS.jailbreak} ({jailbreakCount})
                </Text>
              </Pressable>
              <Pressable style={[styles.tab, tab === "library" && styles.tabActive]} onPress={() => setTab("library")}>
                <Text style={[styles.tabText, tab === "library" && styles.tabTextActive]}>Library</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search prompts..."
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {tab !== "library" ? (
              <>
                <Pressable style={styles.newButton} onPress={startCreate}>
                  <Ionicons name="add-outline" size={18} color="#fff" />
                  <Text style={styles.newButtonText}>
                    New {tab === "jailbreak" ? "jailbreak" : "persona"}
                  </Text>
                </Pressable>
                <FlatList
                  data={filteredSaved}
                  keyExtractor={(p) => p.id}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.list}
                  ListEmptyComponent={
                    <Text style={styles.empty}>
                      {savedForActiveTab.length === 0
                        ? tab === "jailbreak"
                          ? "No jailbreaks yet — create one, or move a persona over with the swap icon."
                          : "No personas yet — create one, or save something from the Library."
                        : `No prompts match "${query}".`}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <View style={styles.row}>
                      <Pressable
                        style={styles.rowContent}
                        onPress={() => {
                          onSelect(item.content);
                          onClose();
                        }}
                      >
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.rowBody} numberOfLines={2}>
                          {item.content}
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
                            onPress={() => deletePrompt(item.id)}
                            style={styles.iconButton}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Confirm delete prompt"
                          >
                            <Ionicons name="checkmark-outline" size={18} color={ERROR} />
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable
                            onPress={() => moveKind(item)}
                            style={styles.iconButton}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={
                              item.kind === "persona" ? "Move to jailbreaks" : "Move to personas"
                            }
                          >
                            <Ionicons name="swap-horizontal-outline" size={16} color={MUTED} />
                          </Pressable>
                          <Pressable
                            onPress={() => startEdit(item)}
                            style={styles.iconButton}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Edit prompt"
                          >
                            <Ionicons name="pencil-outline" size={16} color={MUTED} />
                          </Pressable>
                          <Pressable
                            onPress={() => setConfirmDeleteId(item.id)}
                            style={styles.iconButton}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Delete prompt"
                          >
                            <Ionicons name="trash-outline" size={16} color={MUTED} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                />
              </>
            ) : libraryLoading ? (
              <ActivityIndicator style={styles.center} color={MUTED} />
            ) : libraryError ? (
              <Text style={styles.error}>{libraryError}</Text>
            ) : (
              <>
                <Text style={styles.hint}>
                  Saves land in {kind === "jailbreak" ? "Jailbreaks" : "Personas"} — the slot this picker opened for.
                </Text>
                <FlatList
                  data={filteredLibrary}
                  keyExtractor={(e) => e.id}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.list}
                  ListEmptyComponent={<Text style={styles.empty}>No prompts match "{query}".</Text>}
                  renderItem={({ item }) => {
                    const alreadySaved = savedKeysForLibrary.has(promptKey(item.title, item.content, kind));
                    return (
                      <View style={styles.row}>
                        <Pressable
                          style={styles.rowContent}
                          onPress={() => {
                            onSelect(item.content);
                            onClose();
                          }}
                        >
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.rowBody} numberOfLines={2}>
                            {item.content}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => saveLibraryEntry(item)}
                          style={styles.iconButton}
                          hitSlop={8}
                          disabled={alreadySaved}
                          accessibilityRole="button"
                          accessibilityLabel={alreadySaved ? "Already saved" : "Save to my prompts"}
                        >
                          <Ionicons
                            name={alreadySaved ? "checkmark-outline" : "bookmark-outline"}
                            size={16}
                            color={alreadySaved ? ACCENT : MUTED}
                          />
                        </Pressable>
                      </View>
                    );
                  }}
                />
              </>
            )}
          </>
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
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8, backgroundColor: SURFACE },
  tabActive: { backgroundColor: ACCENT },
  tabText: { color: MUTED, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
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
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  newButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  center: { marginTop: 40 },
  error: { color: ERROR, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  empty: { color: MUTED, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  hint: { color: MUTED, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingHorizontal: 16, gap: 6, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  rowContent: { flex: 1 },
  rowTitle: { color: TEXT, fontSize: 15, fontWeight: "600" },
  rowBody: { color: MUTED, fontSize: 12, marginTop: 2 },
  iconButton: { padding: 6 },
  draftBody: { padding: 16, gap: 6, paddingBottom: 40 },
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: "600", marginTop: 8 },
  titleInput: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT,
  },
  contentInput: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT,
    minHeight: 160,
    textAlignVertical: "top",
  },
  draftActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: MUTED, fontSize: 14, fontWeight: "600" },
  primaryButton: { backgroundColor: ACCENT, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  primaryButtonDisabled: { backgroundColor: "#1e3a6b" },
  primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
