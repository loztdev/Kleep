/**
 * Tier 7.5 phase 2 — presentational relationship graph canvas.
 *
 * Deterministic circular layout (`layoutNodesInCircle`), plain
 * `react-native-svg` shapes for nodes/edges (no physics/force-directed
 * layout library is a dependency here — revisit if the World Bible
 * ever grows large enough that circular layout gets unreadable).
 * Tapping a node highlights its edges and opens a small info card
 * listing what it's connected to and why (the co-occurring fact/lore
 * content) — reuses the same "why" data the cards view exposes via
 * `WhyPanel`, just summarized inline rather than a full provenance
 * bundle, since a graph node can have many edges at once.
 */

import { Fragment, useMemo, useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { ACCENT, BORDER, MUTED, SURFACE, TEXT } from "./theme";
import { layoutNodesInCircle, type GraphEdge, type GraphNode } from "./relationshipGraph";

interface RelationshipGraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_RADIUS = 8;
const NODE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2", "#db2777"];

/** Stable color per `entity_type` — no categorical palette exists in `theme.ts` to reuse. */
function colorForType(entityType: string): string {
  let hash = 0;
  for (let i = 0; i < entityType.length; i++) hash = (hash * 31 + entityType.charCodeAt(i)) | 0;
  return NODE_COLORS[Math.abs(hash) % NODE_COLORS.length]!;
}

export function RelationshipGraphView({ nodes, edges }: RelationshipGraphViewProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = useMemo(() => layoutNodesInCircle(nodes, size), [nodes, size]);

  if (nodes.length === 0) {
    return (
      <Text style={styles.empty}>
        No entities yet — the graph fills in as Kleep learns about people, places, and things.
      </Text>
    );
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const connectedEdges = selectedId
    ? edges.filter((e) => e.source === selectedId || e.target === selectedId)
    : [];
  const connectedNodeIds = new Set(
    connectedEdges.map((e) => (e.source === selectedId ? e.target : e.source)),
  );
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <View style={styles.flex}>
      <View style={styles.canvas} onLayout={onLayout}>
        {size.width > 0 && size.height > 0 ? (
          <Svg width={size.width} height={size.height}>
            {edges.map((edge) => {
              const from = positions.get(edge.source);
              const to = positions.get(edge.target);
              if (!from || !to) return null;
              const touchesSelection =
                selectedId !== null && (edge.source === selectedId || edge.target === selectedId);
              return (
                <Line
                  key={`${edge.source}-${edge.target}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={touchesSelection ? ACCENT : BORDER}
                  strokeWidth={touchesSelection ? 2 : 1}
                  opacity={selectedId === null || touchesSelection ? 1 : 0.25}
                />
              );
            })}
            {nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const isSelected = node.id === selectedId;
              const dimmed = selectedId !== null && !isSelected && !connectedNodeIds.has(node.id);
              const onPress = () => setSelectedId((cur) => (cur === node.id ? null : node.id));
              return (
                <Fragment key={node.id}>
                  {/* Invisible larger hit target — the visible node is well under the ~44pt touch-target guideline. */}
                  <Circle cx={pos.x} cy={pos.y} r={NODE_RADIUS + 12} fill="transparent" onPress={onPress} />
                  <Circle
                    cx={pos.x}
                    cy={pos.y}
                    r={isSelected ? NODE_RADIUS + 3 : NODE_RADIUS}
                    fill={colorForType(node.entityType)}
                    opacity={dimmed ? 0.3 : 1}
                    stroke={isSelected ? "#fff" : "none"}
                    strokeWidth={isSelected ? 2 : 0}
                    onPress={onPress}
                  />
                </Fragment>
              );
            })}
          </Svg>
        ) : null}
        {nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const isSelected = node.id === selectedId;
          const dimmed = selectedId !== null && !isSelected && !connectedNodeIds.has(node.id);
          return (
            <Text
              key={`label-${node.id}`}
              style={[
                styles.nodeLabel,
                { left: pos.x - 40, top: pos.y + NODE_RADIUS + 2 },
                dimmed ? styles.nodeLabelDimmed : null,
              ]}
              numberOfLines={1}
              pointerEvents="none"
            >
              {node.label}
            </Text>
          );
        })}
      </View>

      {selectedNode ? (
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <View style={styles.infoHeaderText}>
              <Text style={styles.infoTitle}>{selectedNode.label}</Text>
              <Text style={styles.infoSubtitle}>{selectedNode.entityType}</Text>
            </View>
            <Pressable onPress={() => setSelectedId(null)} hitSlop={8}>
              <Text style={styles.infoCloseText}>Close</Text>
            </Pressable>
          </View>
          {connectedEdges.length === 0 ? (
            <Text style={styles.infoEmpty}>No known connections yet.</Text>
          ) : (
            <ScrollView style={styles.infoList}>
              {connectedEdges.map((edge) => {
                const otherId = edge.source === selectedId ? edge.target : edge.source;
                const other = nodes.find((n) => n.id === otherId);
                return (
                  <View key={`${edge.source}-${edge.target}`} style={styles.infoRow}>
                    <Text style={styles.infoRowTitle}>{other?.label ?? otherId}</Text>
                    <Text style={styles.infoRowBody} numberOfLines={2}>
                      {edge.reasons.join(" · ")}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  canvas: { flex: 1, overflow: "hidden" },
  empty: { color: MUTED, fontSize: 14, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  nodeLabel: {
    position: "absolute",
    width: 80,
    textAlign: "center",
    color: TEXT,
    fontSize: 11,
  },
  nodeLabelDimmed: { opacity: 0.35 },
  infoCard: {
    backgroundColor: SURFACE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    padding: 16,
    maxHeight: 220,
  },
  infoHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  infoHeaderText: { flex: 1 },
  infoTitle: { color: TEXT, fontSize: 16, fontWeight: "700" },
  infoSubtitle: { color: MUTED, fontSize: 12, marginTop: 2 },
  infoEmpty: { color: MUTED, fontSize: 13, marginTop: 8 },
  infoList: { marginTop: 8 },
  infoRow: { marginBottom: 8 },
  infoRowTitle: { color: ACCENT, fontSize: 13, fontWeight: "600" },
  infoRowBody: { color: MUTED, fontSize: 12, marginTop: 1 },
  infoCloseText: { color: ACCENT, fontSize: 13, fontWeight: "600" },
});
