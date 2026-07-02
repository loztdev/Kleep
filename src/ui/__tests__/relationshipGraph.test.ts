import { MemoryAssetSchema, MemoryKind, Network, newId } from "../../schema";
import { makeProvenance } from "../../schema/__tests__/fixtures";
import { InMemoryStructuredStore } from "../../storage/inMemoryStructuredStore";
import { InMemoryVectorStore } from "../../storage/inMemoryVectorStore";
import { makeEntry, makeLore } from "../../storage/__tests__/fixtures";
import { buildRelationshipGraph, layoutNodesInCircle } from "../relationshipGraph";

function makeFactWithEntities(entityIds: string[], content = "they met") {
  return MemoryAssetSchema.parse({
    id: newId(),
    network: Network.EXPERIENCE,
    kind: MemoryKind.FACT,
    content,
    provenance: makeProvenance(),
    entity_ids: entityIds,
  });
}

describe("buildRelationshipGraph", () => {
  it("returns a node per entity and no edges when nothing co-occurs", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    structured.putEntry(makeEntry("alice"));
    structured.putEntry(makeEntry("bob"));

    const graph = buildRelationshipGraph(structured, vector);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["alice", "bob"]);
    expect(graph.edges).toEqual([]);
  });

  it("adds an edge when a fact mentions two known entities together", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    structured.putEntry(makeEntry("alice"));
    structured.putEntry(makeEntry("bob"));
    structured.put(makeFactWithEntities(["alice", "bob"], "Alice and Bob met at the docks."));

    const graph = buildRelationshipGraph(structured, vector);
    expect(graph.edges).toHaveLength(1);
    expect([graph.edges[0]!.source, graph.edges[0]!.target].sort()).toEqual(["alice", "bob"]);
    expect(graph.edges[0]!.reasons).toEqual(["Alice and Bob met at the docks."]);
  });

  it("dedupes repeated co-occurrence into one edge with multiple reasons", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    structured.putEntry(makeEntry("alice"));
    structured.putEntry(makeEntry("bob"));
    structured.put(makeFactWithEntities(["alice", "bob"], "Fact one."));
    structured.put(makeFactWithEntities(["bob", "alice"], "Fact two."));

    const graph = buildRelationshipGraph(structured, vector);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.reasons.sort()).toEqual(["Fact one.", "Fact two."]);
  });

  it("ignores entity_ids that don't correspond to a known World Bible entity", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    structured.putEntry(makeEntry("alice"));
    structured.put(makeFactWithEntities(["alice", "ghost"], "Alice met a ghost."));

    const graph = buildRelationshipGraph(structured, vector);
    expect(graph.edges).toEqual([]);
  });

  it("adds edges for co-occurrence inside lore snippets too", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    structured.putEntry(makeEntry("alice"));
    structured.putEntry(makeEntry("bob"));
    vector.upsert(
      makeLore([1, 0], { content: "Alice and Bob's story.", entity_ids: ["alice", "bob"] }),
    );

    const graph = buildRelationshipGraph(structured, vector);
    expect(graph.edges).toHaveLength(1);
  });

  it("connects every pair when three or more entities co-occur", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    structured.putEntry(makeEntry("a"));
    structured.putEntry(makeEntry("b"));
    structured.putEntry(makeEntry("c"));
    structured.put(makeFactWithEntities(["a", "b", "c"], "All three met."));

    const graph = buildRelationshipGraph(structured, vector);
    const pairs = graph.edges.map((e) => [e.source, e.target].sort().join("-")).sort();
    expect(pairs).toEqual(["a-b", "a-c", "b-c"]);
  });
});

describe("layoutNodesInCircle", () => {
  it("returns an empty map for no nodes", () => {
    expect(layoutNodesInCircle([], { width: 300, height: 300 }).size).toBe(0);
  });

  it("centers a single node", () => {
    const positions = layoutNodesInCircle([{ id: "a", label: "A", entityType: "x" }], {
      width: 300,
      height: 200,
    });
    expect(positions.get("a")).toEqual({ x: 150, y: 100 });
  });

  it("spaces multiple nodes evenly around the center", () => {
    const nodes = [
      { id: "a", label: "A", entityType: "x" },
      { id: "b", label: "B", entityType: "x" },
      { id: "c", label: "C", entityType: "x" },
      { id: "d", label: "D", entityType: "x" },
    ];
    const positions = layoutNodesInCircle(nodes, { width: 300, height: 300 });
    expect(positions.size).toBe(4);
    // First node sits directly above center (angle -90deg).
    const a = positions.get("a")!;
    expect(a.x).toBeCloseTo(150);
    expect(a.y).toBeLessThan(150);
  });
});
