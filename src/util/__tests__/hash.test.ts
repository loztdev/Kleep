import { fnv1aHash, fnv1aStep } from "../hash";

describe("fnv1aHash", () => {
  it("is deterministic for identical input", () => {
    expect(fnv1aHash("hello")).toBe(fnv1aHash("hello"));
  });

  it("differs (almost always) for different input", () => {
    expect(fnv1aHash("hello")).not.toBe(fnv1aHash("world"));
  });

  it("returns an unsigned 32-bit integer", () => {
    const h = fnv1aHash("anything at all, including unicode 🎲");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it("matches manual fnv1aStep folding", () => {
    const text = "abc";
    let manual = fnv1aHash("") >>> 0;
    for (const ch of text) manual = fnv1aStep(manual, ch.charCodeAt(0));
    expect(fnv1aHash(text)).toBe(manual);
  });
});
