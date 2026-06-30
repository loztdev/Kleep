import { Network } from "../../schema";
import { InMemoryVectorStore } from "../inMemoryVectorStore";
import { makeLore } from "./fixtures";

describe("InMemoryVectorStore", () => {
  it("upserts and gets by id", () => {
    const store = new InMemoryVectorStore();
    const s = makeLore([1, 0, 0]);
    store.upsert(s);
    expect(store.size()).toBe(1);
    expect(store.get(s.id)).toEqual(s);
  });

  it("rejects upsert without an embedding", () => {
    const store = new InMemoryVectorStore();
    // Hand-build to skip the helper's defaults.
    const s = makeLore([1, 0, 0]);
    const bad = { ...s, embedding: undefined };
    expect(() => store.upsert(bad)).toThrow(/embedding/);
  });

  it("rejects mismatched dimensionality on upsert", () => {
    const store = new InMemoryVectorStore();
    store.upsert(makeLore([1, 0, 0]));
    expect(() => store.upsert(makeLore([1, 0]))).toThrow(/dim/);
  });

  it("rejects mismatched dimensionality on query", () => {
    const store = new InMemoryVectorStore();
    store.upsert(makeLore([1, 0, 0]));
    expect(() => store.query([1, 0], 1)).toThrow(/dim/);
  });

  it("returns top-K results sorted by cosine similarity", () => {
    const store = new InMemoryVectorStore();
    const a = makeLore([1, 0, 0]);
    const b = makeLore([0, 1, 0]);
    const c = makeLore([0.9, 0.1, 0]);
    store.upsert(a);
    store.upsert(b);
    store.upsert(c);
    const out = store.query([1, 0, 0], 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.snippet.id).toBe(a.id); // perfect match
    expect(out[1]!.snippet.id).toBe(c.id); // near match
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("topK=0 returns empty", () => {
    const store = new InMemoryVectorStore();
    store.upsert(makeLore([1, 0]));
    expect(store.query([1, 0], 0)).toEqual([]);
  });

  it("filters by network", () => {
    const store = new InMemoryVectorStore();
    const world = makeLore([1, 0], { network: Network.WORLD });
    const exp = makeLore([1, 0], { network: Network.EXPERIENCE });
    store.upsert(world);
    store.upsert(exp);
    const out = store.query([1, 0], 5, { network: Network.WORLD });
    expect(out).toHaveLength(1);
    expect(out[0]!.snippet.id).toBe(world.id);
  });

  it("filters by viewpoint_holder", () => {
    const store = new InMemoryVectorStore();
    const alice = makeLore([1, 0], {
      network: Network.OPINION,
      viewpoint_holder: "alice",
    });
    const bob = makeLore([1, 0], {
      network: Network.OPINION,
      viewpoint_holder: "bob",
    });
    store.upsert(alice);
    store.upsert(bob);
    const out = store.query([1, 0], 5, { viewpoint_holder: "alice" });
    expect(out).toHaveLength(1);
    expect(out[0]!.snippet.id).toBe(alice.id);
  });

  it("filters by tag", () => {
    const store = new InMemoryVectorStore();
    const red = makeLore([1, 0], { tags: ["red"] });
    const blue = makeLore([1, 0], { tags: ["blue"] });
    store.upsert(red);
    store.upsert(blue);
    const out = store.query([1, 0], 5, { tag: "red" });
    expect(out).toHaveLength(1);
    expect(out[0]!.snippet.id).toBe(red.id);
  });

  it("delete works", () => {
    const store = new InMemoryVectorStore();
    const s = makeLore([1, 0]);
    store.upsert(s);
    expect(store.delete(s.id)).toBe(true);
    expect(store.size()).toBe(0);
    expect(store.delete(s.id)).toBe(false);
  });

  it("query on empty store returns empty", () => {
    const store = new InMemoryVectorStore();
    expect(store.query([1, 0], 5)).toEqual([]);
  });

  it("upsert replaces existing snippet", () => {
    const store = new InMemoryVectorStore();
    const s = makeLore([1, 0, 0]);
    store.upsert(s);
    const updated = { ...s, content: "rewritten" };
    store.upsert(updated);
    expect(store.size()).toBe(1);
    expect(store.get(s.id)?.content).toBe("rewritten");
  });
});
