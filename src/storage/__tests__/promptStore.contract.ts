/**
 * Shared behavioral contract for every `PromptStore` implementation —
 * run against both `InMemoryPromptStore` and `SqlitePromptStore` so
 * they're guaranteed to agree.
 */

import type { PromptStore } from "../types";

export function describePromptStoreContract(
  name: string,
  makeStore: () => PromptStore,
): void {
  describe(name, () => {
    it("creates and gets a prompt by id", () => {
      const store = makeStore();
      const saved = store.create({ id: "p1", title: "Pirate", content: "Talk like a pirate.", now: 100 });
      expect(saved).toEqual({
        id: "p1",
        title: "Pirate",
        content: "Talk like a pirate.",
        createdAt: 100,
        updatedAt: 100,
      });
      expect(store.get("p1")).toEqual(saved);
    });

    it("get returns undefined for an unknown id", () => {
      const store = makeStore();
      expect(store.get("missing")).toBeUndefined();
    });

    it("lists prompts most-recently-updated first", () => {
      const store = makeStore();
      store.create({ id: "old", title: "Old", content: "old", now: 100 });
      store.create({ id: "new", title: "New", content: "new", now: 200 });
      expect(store.list().map((p) => p.id)).toEqual(["new", "old"]);
      store.update("old", { title: "Old", content: "old" }, 300);
      expect(store.list().map((p) => p.id)).toEqual(["old", "new"]);
    });

    it("breaks updatedAt ties deterministically by id", () => {
      const store = makeStore();
      store.create({ id: "b", title: "B", content: "b", now: 100 });
      store.create({ id: "a", title: "A", content: "a", now: 100 });
      expect(store.list().map((p) => p.id)).toEqual(["a", "b"]);
    });

    it("update changes title/content and bumps updatedAt", () => {
      const store = makeStore();
      store.create({ id: "p1", title: "Pirate", content: "Talk like a pirate.", now: 100 });
      store.update("p1", { title: "Pirate v2", content: "Talk like a pirate, arr." }, 200);
      expect(store.get("p1")).toEqual({
        id: "p1",
        title: "Pirate v2",
        content: "Talk like a pirate, arr.",
        createdAt: 100,
        updatedAt: 200,
      });
    });

    it("update is a no-op for an unknown id", () => {
      const store = makeStore();
      store.update("missing", { title: "x", content: "y" }, 200);
      expect(store.get("missing")).toBeUndefined();
    });

    it("delete removes a prompt and returns true, false if already gone", () => {
      const store = makeStore();
      store.create({ id: "p1", title: "Pirate", content: "Talk like a pirate.", now: 100 });
      expect(store.delete("p1")).toBe(true);
      expect(store.get("p1")).toBeUndefined();
      expect(store.delete("p1")).toBe(false);
    });

    it("list on an empty store returns []", () => {
      const store = makeStore();
      expect(store.list()).toEqual([]);
    });
  });
}
