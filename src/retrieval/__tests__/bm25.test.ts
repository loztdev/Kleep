import { Bm25Index } from "../bm25";
import { tokenize } from "../tokenize";

describe("tokenize", () => {
  it("lowercases and splits on non-word chars", () => {
    expect(tokenize("The Quick, Brown FOX!")).toEqual([
      "the",
      "quick",
      "brown",
      "fox",
    ]);
  });

  it("keeps apostrophes (contractions stay one token)", () => {
    expect(tokenize("don't stop")).toEqual(["don't", "stop"]);
  });

  it("filters empty splits", () => {
    expect(tokenize("a  b   c")).toEqual(["a", "b", "c"]);
  });

  it("empty input returns []", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("Bm25Index", () => {
  it("ranks exact matches above partial matches", () => {
    const idx = new Bm25Index();
    idx.add("a", "Mojo is a Pomeranian puppy.");
    idx.add("b", "Mojo went for a walk in the park.");
    idx.add("c", "Alice cooked dinner.");
    const out = idx.search("Pomeranian puppy", 5);
    expect(out[0]!.id).toBe("a");
  });

  it("matches single rare terms", () => {
    const idx = new Bm25Index();
    idx.add("a", "Mojo is a Pomeranian puppy.");
    idx.add("b", "The desert hums at noon.");
    const out = idx.search("desert", 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("b");
  });

  it("returns empty when no terms match", () => {
    const idx = new Bm25Index();
    idx.add("a", "Mojo is a Pomeranian puppy.");
    expect(idx.search("xylophone", 5)).toEqual([]);
  });

  it("topK clamps result count", () => {
    const idx = new Bm25Index();
    for (let i = 0; i < 5; i++) idx.add(`d${i}`, "Mojo Mojo Mojo");
    const out = idx.search("Mojo", 2);
    expect(out).toHaveLength(2);
  });

  it("respects length-normalization (shorter doc wins on same tf)", () => {
    const idx = new Bm25Index();
    idx.add("short", "Pomeranian");
    idx.add("long", "Pomeranian " + "filler ".repeat(200));
    const out = idx.search("Pomeranian", 2);
    expect(out[0]!.id).toBe("short");
  });

  it("re-add replaces (no double-counting)", () => {
    const idx = new Bm25Index();
    idx.add("a", "puppy puppy puppy");
    idx.add("a", "wolf wolf wolf");
    expect(idx.search("puppy", 5)).toEqual([]);
    expect(idx.search("wolf", 5)[0]!.id).toBe("a");
  });

  it("remove drops from index", () => {
    const idx = new Bm25Index();
    idx.add("a", "Pomeranian puppy");
    expect(idx.remove("a")).toBe(true);
    expect(idx.size()).toBe(0);
    expect(idx.search("puppy", 5)).toEqual([]);
  });

  it("remove returns false for unknown id", () => {
    const idx = new Bm25Index();
    expect(idx.remove("missing")).toBe(false);
  });

  it("tolerates empty-text documents", () => {
    const idx = new Bm25Index();
    idx.add("empty", "");
    idx.add("real", "Pomeranian puppy");
    expect(idx.size()).toBe(2);
    expect(idx.search("puppy", 5)[0]!.id).toBe("real");
  });

  it("search() empty index returns []", () => {
    expect(new Bm25Index().search("anything", 5)).toEqual([]);
  });
});
