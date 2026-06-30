/**
 * Tier 4.8 — React Native "Why UI" component.
 *
 * Renders a ProvenanceBundle as an expandable epistemic-traceability
 * card: headline → confidence chip → list of anchored quotes the user
 * can tap to expand. Native primitives only (no third-party UI deps)
 * so it ships on iOS and Android out of the box.
 *
 * The component is purely presentational — it takes a bundle (built by
 * `explain.ts` from any AnyAsset) and renders. No data fetching,
 * no router/store imports — keep it dumb so it's trivially reusable.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ProvenanceBundle } from "./types";

export interface WhyPanelProps {
  bundle: ProvenanceBundle;
  /** Called when the user taps an anchor's "go to turn" affordance. */
  onJumpToTurn?: (turnId: string) => void;
  /** Render in compact mode (one-line header only, no expand toggle). */
  compact?: boolean;
}

export function WhyPanel({
  bundle,
  onJumpToTurn,
  compact = false,
}: WhyPanelProps): React.ReactElement {
  const [expanded, setExpanded] = useState(!compact);
  const showToggle = !compact;

  return (
    <View style={styles.root} accessibilityRole="summary">
      <View style={styles.header}>
        <Text style={styles.headline} numberOfLines={2}>
          {bundle.subject.headline}
        </Text>
        <ConfidenceChip bundle={bundle} />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{bundle.subject.kind}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{bundle.subject.network}</Text>
        {bundle.viewpoint_holder ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>
              POV: {bundle.viewpoint_holder}
            </Text>
          </>
        ) : null}
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>
          {bundle.corroboration} witness
          {bundle.corroboration === 1 ? "" : "es"}
        </Text>
      </View>

      {showToggle ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Hide evidence" : "Show evidence"}
          style={styles.toggle}
        >
          <Text style={styles.toggleText}>
            {expanded ? "Hide evidence" : "Show evidence"}
          </Text>
        </Pressable>
      ) : null}

      {expanded ? (
        <View style={styles.anchorList}>
          {bundle.anchors.map((a, i) => (
            <Pressable
              key={`${a.turn_id}:${i}`}
              onPress={
                onJumpToTurn ? () => onJumpToTurn(a.turn_id) : undefined
              }
              accessibilityRole={onJumpToTurn ? "button" : undefined}
              accessibilityLabel={`Evidence from turn ${a.turn_id}`}
              style={styles.anchor}
            >
              <Text style={styles.anchorTurn}>turn {a.turn_id}</Text>
              <Text style={styles.anchorQuote}>“{a.quote}”</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {bundle.temporal.narrative_always ? (
        <Text style={styles.footer}>Timeless (world rule)</Text>
      ) : bundle.temporal.turn_end ? (
        <Text style={styles.footer}>
          Valid {bundle.temporal.turn_start} → {bundle.temporal.turn_end}
        </Text>
      ) : (
        <Text style={styles.footer}>
          Since {bundle.temporal.turn_start}
        </Text>
      )}
    </View>
  );
}

function ConfidenceChip({
  bundle,
}: {
  bundle: ProvenanceBundle;
}): React.ReactElement {
  const pct = Math.round(bundle.confidence.score * 100);
  const tone = chipTone(bundle.confidence.score);
  return (
    <View
      style={[styles.chip, { backgroundColor: tone.bg }]}
      accessibilityLabel={`Confidence ${pct} percent, source ${bundle.confidence.source}`}
    >
      <Text style={[styles.chipText, { color: tone.fg }]}>{pct}%</Text>
    </View>
  );
}

function chipTone(score: number): { bg: string; fg: string } {
  if (score >= 0.8) return { bg: "#1f8a3b", fg: "#fff" };
  if (score >= 0.5) return { bg: "#c2a000", fg: "#222" };
  return { bg: "#8a1f1f", fg: "#fff" };
}

const styles = StyleSheet.create({
  root: {
    padding: 12,
    backgroundColor: "#f5f5f7",
    borderRadius: 12,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  headline: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 12,
    color: "#555",
  },
  metaDot: {
    fontSize: 12,
    color: "#aaa",
  },
  toggle: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  toggleText: {
    fontSize: 13,
    color: "#1769ff",
    fontWeight: "500",
  },
  anchorList: {
    gap: 6,
    marginTop: 2,
  },
  anchor: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  anchorTurn: {
    fontSize: 11,
    color: "#666",
    fontVariant: ["tabular-nums"],
  },
  anchorQuote: {
    fontSize: 14,
    color: "#1a1a1a",
    fontStyle: "italic",
  },
  footer: {
    fontSize: 11,
    color: "#888",
    marginTop: 2,
  },
});
