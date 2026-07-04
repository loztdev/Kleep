/**
 * Tier 7.5 — the Memory Browser: World Bible entity cards and Lore
 * snippet cards, both backed by the same continuous store every chat
 * session shares (see `ChatScreen.tsx`'s doc comment). Each card can
 * open a `WhyPanel` (Tier 4.8) for "why do I believe this" provenance —
 * `explain()`/`explainAttribute()` build the bundle straight from the
 * already-fetched asset, no extra store calls needed.
 *
 * Cards-first per the product decision to ship a browsable list before
 * a relationship graph visualizer (Tier 7.5 phase 2).
 */

import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { explain, explainAttribute, type ProvenanceBundle } from "../explain";
import { WhyPanel } from "../explain/WhyPanel";
import { MemoryKind, type LoreSnippet, type WorldBibleEntry } from "../schema";
import type { StructuredStore, VectorStore } from "../storage";
import { buildRelationshipGraph } from "./relationshipGraph";
import { RelationshipGraphView } from "./RelationshipGraphView";
import { ACCENT, BG, BORDER, ERROR, MUTED, SURFACE, TEXT } from "./theme";

interface MemoryBrowserScreenProps {
  structured: StructuredStore;
  vector: VectorStore;
  onClose: () => void;
}

type Tab = "entities" | "lore" | "graph";

export function MemoryBrowserScreen({ structured, vector, onClose }: MemoryBrowserScreenProps) {
  const [tab, setTab] = useState<Tab>("entities");
  // Deletes mutate the underlying stores in place, so a plain
  // `useMemo(..., [structured])` never re-reads. Bumping this tick after every
  // delete forces every list/graph memo to recompute — cheaper than making the
  // stores observable just for a "refresh after mutation" affordance the
  // detail modal owns end-to-end.
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = () => setRefreshTick((n) => n + 1);
  const entities = useMemo(
    () => structured.query({ kind: MemoryKind.ENTITY }).filter(isWorldBibleEntry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structured, refreshTick],
  );
  const lore = useMemo(
    () => vector.list(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vector, refreshTick],
  );
  const graph = useMemo(
    () => buildRelationshipGraph(structured, vector),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structured, vector, refreshTick],
  );

  const [selectedEntity, setSelectedEntity] = useState<WorldBibleEntry | null>(null);
  const [selectedLore, setSelectedLore] = useState<LoreSnippet | null>(null);

  const handleDeleteEntity = (id: string) => {
    structured.delete(id);
    setSelectedEntity(null);
    refresh();
  };
  const handleDeleteLore = (id: string) => {
    vector.delete(id);
    setSelectedLore(null);
    refresh();
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Memory</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close memory browser">
          <Ionicons name="close-outline" size={24} color={TEXT} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === "entities" && styles.tabActive]}
          onPress={() => setTab("entities")}
        >
          <Text style={[styles.tabText, tab === "entities" && styles.tabTextActive]}>
            World Bible ({entities.length})
          </Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "lore" && styles.tabActive]} onPress={() => setTab("lore")}>
          <Text style={[styles.tabText, tab === "lore" && styles.tabTextActive]}>Lore ({lore.length})</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "graph" && styles.tabActive]} onPress={() => setTab("graph")}>
          <Text style={[styles.tabText, tab === "graph" && styles.tabTextActive]}>Graph</Text>
        </Pressable>
      </View>

      {tab === "graph" ? (
        <RelationshipGraphView nodes={graph.nodes} edges={graph.edges} />
      ) : tab === "entities" ? (
        entities.length === 0 ? (
          <Text style={styles.empty}>
            No entities yet — people, places, and things Kleep learns about will show up here.
          </Text>
        ) : (
          <FlatList
            data={entities}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable style={styles.card} onPress={() => setSelectedEntity(item)}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.canonical_name}
                </Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {item.entity_type}
                  {item.aliases.length ? ` · aka ${item.aliases.join(", ")}` : ""}
                </Text>
                {item.summary ? (
                  <Text style={styles.cardBody} numberOfLines={2}>
                    {item.summary}
                  </Text>
                ) : null}
              </Pressable>
            )}
          />
        )
      ) : lore.length === 0 ? (
        <Text style={styles.empty}>
          No lore yet — background details Kleep infers about the world will show up here.
        </Text>
      ) : (
        <FlatList
          data={lore}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelectedLore(item)}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title ?? item.content}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {item.network}
                {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
              </Text>
              <Text style={styles.cardBody} numberOfLines={2}>
                {item.content}
              </Text>
            </Pressable>
          )}
        />
      )}

      {selectedEntity ? (
        <EntityDetailModal
          entry={selectedEntity}
          onClose={() => setSelectedEntity(null)}
          onDelete={() => handleDeleteEntity(selectedEntity.id)}
        />
      ) : null}
      {selectedLore ? (
        <LoreDetailModal
          snippet={selectedLore}
          onClose={() => setSelectedLore(null)}
          onDelete={() => handleDeleteLore(selectedLore.id)}
        />
      ) : null}
    </View>
  );
}

function isWorldBibleEntry(asset: { kind: string }): asset is WorldBibleEntry {
  return asset.kind === MemoryKind.ENTITY;
}

function formatAttributeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

function EntityDetailModal({
  entry,
  onClose,
  onDelete,
}: {
  entry: WorldBibleEntry;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [whyBundle, setWhyBundle] = useState<ProvenanceBundle | null>(null);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.detailContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {entry.canonical_name}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close-outline" size={24} color={TEXT} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.detailBody}>
          <Text style={styles.detailMeta}>{entry.entity_type}</Text>
          {entry.aliases.length ? (
            <Text style={styles.detailMeta}>aka {entry.aliases.join(", ")}</Text>
          ) : null}
          <DetailActionsRow
            onWhy={() => setWhyBundle(explain(entry))}
            onDelete={onDelete}
            deleteLabel="Delete this entity"
          />
          {entry.summary ? <Text style={styles.detailSummary}>{entry.summary}</Text> : null}

          <Text style={styles.sectionTitle}>Attributes</Text>
          {entry.attributes.length === 0 ? (
            <Text style={styles.empty}>No attributes recorded yet.</Text>
          ) : (
            entry.attributes.map((attr) => (
              <View key={attr.key} style={styles.attrRow}>
                <View style={styles.attrTextCol}>
                  <Text style={styles.attrKey}>{attr.key}</Text>
                  <Text style={styles.attrValue}>{formatAttributeValue(attr.value)}</Text>
                </View>
                <Pressable
                  onPress={() => setWhyBundle(explainAttribute(entry, attr.key))}
                  style={styles.iconButton}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Why do I know ${attr.key}`}
                >
                  <Ionicons name="information-circle-outline" size={18} color={MUTED} />
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>
      <WhySheet bundle={whyBundle} onClose={() => setWhyBundle(null)} />
    </Modal>
  );
}

function LoreDetailModal({
  snippet,
  onClose,
  onDelete,
}: {
  snippet: LoreSnippet;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [whyBundle, setWhyBundle] = useState<ProvenanceBundle | null>(null);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.detailContainer}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {snippet.title ?? "Lore"}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close-outline" size={24} color={TEXT} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.detailBody}>
          <Text style={styles.detailMeta}>
            {snippet.network}
            {snippet.viewpoint_holder ? ` · POV: ${snippet.viewpoint_holder}` : ""}
          </Text>
          {snippet.tags.length ? (
            <Text style={styles.detailMeta}>tags: {snippet.tags.join(", ")}</Text>
          ) : null}
          <DetailActionsRow
            onWhy={() => setWhyBundle(explain(snippet))}
            onDelete={onDelete}
            deleteLabel="Delete this lore snippet"
          />
          <Text style={styles.detailSummary}>{snippet.content}</Text>
        </ScrollView>
      </View>
      <WhySheet bundle={whyBundle} onClose={() => setWhyBundle(null)} />
    </Modal>
  );
}

/** The "Why do I know this?" + delete pair that both detail modals surface.
 * Extracted so the two modals share one implementation of the layout AND the
 * "arm-then-confirm" state — earlier revisions kept the confirm state up in
 * the parent modal, which meant both modals had to duplicate the same three
 * hooks and props to wire it up. */
function DetailActionsRow({
  onWhy,
  onDelete,
  deleteLabel,
}: {
  onWhy: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <View style={styles.detailActionsRow}>
      <Pressable style={styles.whyButton} onPress={onWhy}>
        <Ionicons name="information-circle-outline" size={16} color={ACCENT} />
        <Text style={styles.whyButtonText}>Why do I know this?</Text>
      </Pressable>
      <DeleteMemoryButton
        confirming={confirmingDelete}
        onArm={() => setConfirmingDelete(true)}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={onDelete}
        accessibilityLabelIdle={deleteLabel}
      />
    </View>
  );
}

/** Two-tap delete affordance. Tap once to arm (icon flips to a red checkmark
 * + a cancel X appears next to it), tap the checkmark to fire. Same pattern
 * as the wipe-history button on ChatScreen — a single-button destructive
 * action doesn't need a full confirmation modal when a second tap is the
 * confirmation. Now called only through `DetailActionsRow`. */
function DeleteMemoryButton({
  confirming,
  onArm,
  onCancel,
  onConfirm,
  accessibilityLabelIdle,
}: {
  confirming: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  accessibilityLabelIdle: string;
}) {
  if (confirming) {
    return (
      <View style={styles.deleteRow}>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel delete"
        >
          <Ionicons name="close-outline" size={18} color={MUTED} />
        </Pressable>
        <Pressable
          onPress={onConfirm}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Confirm delete"
        >
          <Ionicons name="checkmark-outline" size={18} color={ERROR} />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onArm}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelIdle}
    >
      <Ionicons name="trash-outline" size={18} color={MUTED} />
    </Pressable>
  );
}

/** Bottom-sheet-style overlay for a single `WhyPanel`. */
function WhySheet({ bundle, onClose }: { bundle: ProvenanceBundle | null; onClose: () => void }) {
  if (!bundle) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.whyOverlay} onPress={onClose}>
        <Pressable style={styles.whySheet} onPress={(e) => e.stopPropagation()}>
          <WhyPanel bundle={bundle} />
          <Pressable style={styles.whyCloseButton} onPress={onClose}>
            <Text style={styles.whyCloseButtonText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: TEXT, flexShrink: 1 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: SURFACE,
  },
  tabActive: { backgroundColor: ACCENT },
  tabText: { color: MUTED, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  empty: { color: MUTED, fontSize: 14, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 24 },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  cardTitle: { color: TEXT, fontSize: 15, fontWeight: "600" },
  cardSubtitle: { color: MUTED, fontSize: 12 },
  cardBody: { color: MUTED, fontSize: 13, marginTop: 4 },
  detailContainer: { flex: 1, backgroundColor: BG },
  detailBody: { padding: 16, gap: 10, paddingBottom: 40 },
  detailMeta: { color: MUTED, fontSize: 13 },
  detailSummary: { color: TEXT, fontSize: 15, lineHeight: 21, marginTop: 4 },
  sectionTitle: { color: TEXT, fontSize: 16, fontWeight: "700", marginTop: 12 },
  detailActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  whyButton: { flexDirection: "row", alignItems: "center", gap: 6 },
  whyButtonText: { color: ACCENT, fontSize: 13, fontWeight: "600" },
  deleteRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  attrRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: SURFACE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attrTextCol: { flex: 1, gap: 2 },
  attrKey: { color: MUTED, fontSize: 12, fontWeight: "600" },
  attrValue: { color: TEXT, fontSize: 14 },
  iconButton: { padding: 4 },
  whyOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  whySheet: {
    backgroundColor: "#f5f5f7",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  whyCloseButton: { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 10 },
  whyCloseButtonText: { color: "#1769ff", fontSize: 14, fontWeight: "600" },
});
