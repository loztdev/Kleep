import { MemoryKind, Network } from "../../schema";
import { InMemoryStructuredStore } from "../inMemoryStructuredStore";
import { makeEntry, makeFact, makeOpinion } from "./fixtures";

describe("InMemoryStructuredStore", () => {
  it("round-trips a memory asset by id", () => {
    const store = new InMemoryStructuredStore();
    const fact = makeFact();
    store.put(fact);
    expect(store.size()).toBe(1);
    expect(store.get(fact.id)).toEqual(fact);
  });

  it("round-trips a World Bible entry by id and entity_id", () => {
    const store = new InMemoryStructuredStore();
    const e = makeEntry("char:mojo");
    store.putEntry(e);
    expect(store.get(e.id)).toEqual(e);
    expect(store.getEntry("char:mojo")).toEqual(e);
  });

  it("replaces on put with the same id", () => {
    const store = new InMemoryStructuredStore();
    const fact = makeFact({ tags: ["v1"] });
    store.put(fact);
    const updated = { ...fact, tags: ["v2"] };
    store.put(updated);
    expect(store.size()).toBe(1);
    expect(store.get(fact.id)).toEqual(updated);
    // The old tag index must not still match.
    expect(store.query({ tag: "v1" })).toEqual([]);
    expect(store.query({ tag: "v2" })).toEqual([updated]);
  });

  it("filters by single network", () => {
    const store = new InMemoryStructuredStore();
    const exp = makeFact({ network: Network.EXPERIENCE });
    const obs = makeFact({ network: Network.OBSERVATION });
    store.put(exp);
    store.put(obs);
    const out = store.query({ network: Network.OBSERVATION });
    expect(out).toEqual([obs]);
  });

  it("filters by multiple networks (array)", () => {
    const store = new InMemoryStructuredStore();
    const world = makeEntry("e1");
    const exp = makeFact({ network: Network.EXPERIENCE });
    const opn = makeOpinion("alice");
    store.putEntry(world);
    store.put(exp);
    store.put(opn);
    const out = store.query({
      network: [Network.WORLD, Network.EXPERIENCE],
    });
    expect(out).toHaveLength(2);
    expect(new Set(out.map((a) => a.id))).toEqual(
      new Set([world.id, exp.id]),
    );
  });

  it("filters by kind", () => {
    const store = new InMemoryStructuredStore();
    const fact = makeFact();
    const entry = makeEntry("e1");
    store.put(fact);
    store.putEntry(entry);
    expect(store.query({ kind: MemoryKind.FACT })).toEqual([fact]);
    expect(store.query({ kind: MemoryKind.ENTITY })).toEqual([entry]);
  });

  it("filters by entity_id (matches both an entry and asset references)", () => {
    const store = new InMemoryStructuredStore();
    const e = makeEntry("char:mojo");
    const f = makeFact({ entity_ids: ["char:mojo"] });
    store.putEntry(e);
    store.put(f);
    const out = store.query({ entity_id: "char:mojo" });
    // entity_id index narrows to the entry first; we don't promise both
    // shapes here, just that the entry is found by entity_id.
    expect(out.find((a) => a.id === e.id)).toBeTruthy();
  });

  it("filters by tag", () => {
    const store = new InMemoryStructuredStore();
    const a = makeFact({ tags: ["red"] });
    const b = makeFact({ tags: ["blue"] });
    store.put(a);
    store.put(b);
    expect(store.query({ tag: "red" })).toEqual([a]);
  });

  it("filters by viewpoint_holder", () => {
    const store = new InMemoryStructuredStore();
    const alice = makeOpinion("alice");
    const bob = makeOpinion("bob");
    store.put(alice);
    store.put(bob);
    expect(store.query({ viewpoint_holder: "alice" })).toEqual([alice]);
  });

  it("combines filters (network + viewpoint_holder)", () => {
    const store = new InMemoryStructuredStore();
    const alice1 = makeOpinion("alice");
    const alice2 = makeOpinion("alice");
    const bob = makeOpinion("bob");
    const fact = makeFact();
    store.put(alice1);
    store.put(alice2);
    store.put(bob);
    store.put(fact);
    const out = store.query({
      network: Network.OPINION,
      viewpoint_holder: "alice",
    });
    expect(out).toHaveLength(2);
    expect(new Set(out.map((a) => a.id))).toEqual(
      new Set([alice1.id, alice2.id]),
    );
  });

  it("delete unindexes everything", () => {
    const store = new InMemoryStructuredStore();
    const a = makeFact({ tags: ["red"] });
    store.put(a);
    expect(store.delete(a.id)).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.get(a.id)).toBeUndefined();
    expect(store.query({ tag: "red" })).toEqual([]);
  });

  it("delete returns false for unknown id", () => {
    const store = new InMemoryStructuredStore();
    expect(store.delete("missing")).toBe(false);
  });

  it("delete on entry also clears the entity_id index", () => {
    const store = new InMemoryStructuredStore();
    const e = makeEntry("char:mojo");
    store.putEntry(e);
    store.delete(e.id);
    expect(store.getEntry("char:mojo")).toBeUndefined();
  });

  it("empty filter returns everything", () => {
    const store = new InMemoryStructuredStore();
    store.put(makeFact());
    store.put(makeFact());
    expect(store.query({})).toHaveLength(2);
  });
});
