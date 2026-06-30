import {
  Network,
  WorldBibleEntrySchema,
  newId,
  type WorldBibleEntry,
} from "../../schema";
import { makeProvenance } from "../../schema/__tests__/fixtures";
import { EntityIndex } from "../entityIndex";

function entry(
  entityId: string,
  canonical: string,
  aliases: string[] = [],
): WorldBibleEntry {
  return WorldBibleEntrySchema.parse({
    id: newId(),
    network: Network.WORLD,
    content: `${canonical} card`,
    provenance: makeProvenance(),
    entity_id: entityId,
    entity_type: "character",
    canonical_name: canonical,
    aliases,
  });
}

describe("EntityIndex", () => {
  it("registers canonical name and aliases", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:mojo", "Mojo Jojo", ["Mojo", "MJ"]));
    expect(idx.idsForName("mojo jojo")).toEqual(["char:mojo"]);
    expect(idx.idsForName("mojo")).toEqual(["char:mojo"]);
    expect(idx.idsForName("MJ")).toEqual(["char:mojo"]);
  });

  it("mentionsIn finds a name in free-form text", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:mojo", "Mojo"));
    expect(idx.mentionsIn("Where did Mojo run off to?")).toEqual([
      "char:mojo",
    ]);
  });

  it("mentionsIn respects word boundaries", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:al", "Al"));
    expect(idx.mentionsIn("almost")).toEqual([]);
  });

  it("mentionsIn prefers longer names (no double-count)", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:mojo", "Mojo"));
    idx.add(entry("char:mojo-jojo", "Mojo Jojo"));
    const out = idx.mentionsIn("Mojo Jojo arrived.");
    // "Mojo Jojo" wins; the bare "Mojo" claim is suppressed by the
    // overlap rule, so we get only the long entity.
    expect(out).toEqual(["char:mojo-jojo"]);
  });

  it("mentionsIn returns multiple distinct entities", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:mojo", "Mojo"));
    idx.add(entry("char:alice", "Alice"));
    const out = idx.mentionsIn("Alice met Mojo.");
    expect(new Set(out)).toEqual(new Set(["char:alice", "char:mojo"]));
  });

  it("re-adding an entity replaces its names", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:mojo", "Mojo", ["MJ"]));
    idx.add(entry("char:mojo", "Mojo", [])); // drop MJ
    expect(idx.idsForName("MJ")).toEqual([]);
    expect(idx.idsForName("Mojo")).toEqual(["char:mojo"]);
  });

  it("remove unindexes everything", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:mojo", "Mojo", ["MJ"]));
    expect(idx.remove("char:mojo")).toBe(true);
    expect(idx.idsForName("Mojo")).toEqual([]);
    expect(idx.idsForName("MJ")).toEqual([]);
    expect(idx.size()).toBe(0);
  });

  it("remove returns false for unknown id", () => {
    expect(new EntityIndex().remove("missing")).toBe(false);
  });

  it("mentionsIn on empty index returns []", () => {
    expect(new EntityIndex().mentionsIn("hello world")).toEqual([]);
  });

  it("two entities sharing a name both appear under that name", () => {
    const idx = new EntityIndex();
    idx.add(entry("char:a", "Mojo"));
    idx.add(entry("char:b", "Mojo")); // distinct entity with same name
    expect(new Set(idx.idsForName("mojo"))).toEqual(
      new Set(["char:a", "char:b"]),
    );
  });
});
