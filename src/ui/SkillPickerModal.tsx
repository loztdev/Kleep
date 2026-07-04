/**
 * Skills picker — the multi-select cousin of `PromptPickerModal`.
 *
 * Two roles rolled into one modal:
 * 1. Choose which skills are ACTIVE for this chat (checkboxes on the left).
 *    Multi-select, since a chat often benefits from a stack (e.g. "Scene
 *    Structure" + "Character Voice" + "Crude Language").
 * 2. Author skills — create, edit, delete — inline via a draft form.
 *
 * Deliberately a per-chat modal (not a per-app default like personas):
 * different stories have different skill needs. If a skill should apply to
 * every chat by default, it's a persona/jailbreak concern, not a skill.
 */

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { newId } from "../schema";
import type { SavedSkill, SkillStore } from "../storage";
import { ACCENT, BG, BORDER, ERROR, MUTED, SURFACE, TEXT } from "./theme";

interface SkillPickerModalProps {
  visible: boolean;
  skillStore: SkillStore;
  activeIds: readonly string[];
  onActiveIdsChange: (next: string[]) => void;
  onClose: () => void;
}

export function SkillPickerModal({
  visible,
  skillStore,
  activeIds,
  onActiveIdsChange,
  onClose,
}: SkillPickerModalProps) {
  const [skills, setSkills] = useState<SavedSkill[]>([]);
  const [query, setQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftWhenToUse, setDraftWhenToUse] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setCreating(false);
    setEditingId(null);
    setConfirmDeleteId(null);
    setSkills(skillStore.list());
  }, [visible, skillStore]);

  useEffect(() => {
    setSkills(skillStore.list());
  }, [skillStore, refreshTick]);

  const refresh = () => setRefreshTick((n) => n + 1);
  const activeSet = new Set(activeIds);

  const toggleActive = (id: string) => {
    if (activeSet.has(id)) {
      onActiveIdsChange(activeIds.filter((x) => x !== id));
    } else {
      onActiveIdsChange([...activeIds, id]);
    }
  };

  const startCreate = () => {
    setEditingId(null);
    setDraftName("");
    setDraftDescription("");
    setDraftWhenToUse("");
    setDraftBody("");
    setCreating(true);
  };

  const startEdit = (skill: SavedSkill) => {
    setCreating(false);
    setEditingId(skill.id);
    setDraftName(skill.name);
    setDraftDescription(skill.description);
    setDraftWhenToUse(skill.whenToUse);
    setDraftBody(skill.body);
  };

  const cancelDraft = () => {
    setCreating(false);
    setEditingId(null);
  };

  const draftIsValid =
    draftName.trim().length > 0 &&
    draftDescription.trim().length > 0 &&
    draftWhenToUse.trim().length > 0 &&
    draftBody.trim().length > 0;

  const submitDraft = () => {
    if (!draftIsValid) return;
    const fields = {
      name: draftName.trim(),
      description: draftDescription.trim(),
      whenToUse: draftWhenToUse.trim(),
      body: draftBody.trim(),
    };
    if (editingId) {
      skillStore.update(editingId, fields, Date.now());
    } else {
      const id = newId();
      skillStore.create({ id, ...fields, now: Date.now() });
      // New skills default to active — the assumption is you wouldn't
      // author one you didn't intend to use in this chat.
      onActiveIdsChange([...activeIds, id]);
    }
    setCreating(false);
    setEditingId(null);
    refresh();
  };

  const deleteSkill = (id: string) => {
    skillStore.delete(id);
    // Also drop it from the active set for this chat — a dangling
    // reference wouldn't break anything (see `parseActiveSkillIds` in
    // ChatSessionStore) but leaving it in reads as "still active" in the
    // count.
    if (activeSet.has(id)) onActiveIdsChange(activeIds.filter((x) => x !== id));
    setConfirmDeleteId(null);
    refresh();
  };

  const q = query.trim().toLowerCase();
  const filtered = skills.filter(
    (s) =>
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.whenToUse.toLowerCase().includes(q),
  );

  const showingDraft = creating || editingId !== null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Skills</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close-outline" size={24} color={TEXT} />
          </Pressable>
        </View>

        {showingDraft ? (
          <ScrollView contentContainerStyle={styles.draftBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.singleInput}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. Scene Structure"
              placeholderTextColor={MUTED}
              autoFocus
            />
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={styles.singleInput}
              value={draftDescription}
              onChangeText={setDraftDescription}
              placeholder="One line — what the skill does."
              placeholderTextColor={MUTED}
            />
            <Text style={styles.fieldLabel}>When to use</Text>
            <TextInput
              style={styles.singleInput}
              value={draftWhenToUse}
              onChangeText={setDraftWhenToUse}
              placeholder="One line — when the model should apply it."
              placeholderTextColor={MUTED}
            />
            <Text style={styles.fieldLabel}>Body</Text>
            <TextInput
              style={styles.bodyInput}
              value={draftBody}
              onChangeText={setDraftBody}
              placeholder="The actual guidance — rules, examples, dos and don'ts."
              placeholderTextColor={MUTED}
              multiline
            />
            <View style={styles.draftActions}>
              <Pressable style={styles.secondaryButton} onPress={cancelDraft}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, !draftIsValid && styles.primaryButtonDisabled]}
                onPress={submitDraft}
                disabled={!draftIsValid}
              >
                <Text style={styles.primaryButtonText}>{editingId ? "Save changes" : "Save skill"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search skills..."
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={styles.newButton} onPress={startCreate}>
              <Ionicons name="add-outline" size={18} color="#fff" />
              <Text style={styles.newButtonText}>New skill</Text>
            </Pressable>
            <FlatList
              data={filtered}
              keyExtractor={(s) => s.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {skills.length === 0
                    ? "No skills yet — start with the Skill Authoring skill for a guide, or create one from scratch."
                    : `No skills match "${query}".`}
                </Text>
              }
              renderItem={({ item }) => {
                const isActive = activeSet.has(item.id);
                return (
                  <View style={styles.row}>
                    <Pressable
                      onPress={() => toggleActive(item.id)}
                      style={styles.checkBox}
                      hitSlop={8}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isActive }}
                      accessibilityLabel={`${isActive ? "Deactivate" : "Activate"} ${item.name}`}
                    >
                      <Ionicons
                        name={isActive ? "checkbox" : "square-outline"}
                        size={20}
                        color={isActive ? ACCENT : MUTED}
                      />
                    </Pressable>
                    <Pressable style={styles.rowContent} onPress={() => startEdit(item)}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowBody} numberOfLines={2}>
                        {item.description}
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
                          onPress={() => deleteSkill(item.id)}
                          style={styles.iconButton}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Confirm delete skill"
                        >
                          <Ionicons name="checkmark-outline" size={18} color={ERROR} />
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        onPress={() => setConfirmDeleteId(item.id)}
                        style={styles.iconButton}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete skill"
                      >
                        <Ionicons name="trash-outline" size={16} color={MUTED} />
                      </Pressable>
                    )}
                  </View>
                );
              }}
            />
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
  empty: { color: MUTED, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  list: { paddingHorizontal: 16, gap: 6, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  checkBox: { paddingHorizontal: 4, paddingVertical: 4 },
  rowContent: { flex: 1, paddingHorizontal: 4 },
  rowTitle: { color: TEXT, fontSize: 15, fontWeight: "600" },
  rowBody: { color: MUTED, fontSize: 12, marginTop: 2 },
  iconButton: { padding: 6 },
  draftBody: { padding: 16, gap: 6, paddingBottom: 40 },
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: "600", marginTop: 8 },
  singleInput: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT,
  },
  bodyInput: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT,
    minHeight: 220,
    textAlignVertical: "top",
  },
  draftActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: MUTED, fontSize: 14, fontWeight: "600" },
  primaryButton: { backgroundColor: ACCENT, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  primaryButtonDisabled: { backgroundColor: "#1e3a6b" },
  primaryButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
