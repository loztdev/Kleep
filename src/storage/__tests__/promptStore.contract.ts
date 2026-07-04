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
    it("creates and gets a prompt by id, defaulting kind to persona", () => {
      const store = makeStore();
      const saved = store.create({ id: "p1", title: "Pirate", content: "Talk like a pirate.", now: 100 });
      expect(saved).toEqual({
        id: "p1",
        title: "Pirate",
        content: "Talk like a pirate.",
        kind: "persona",
        createdAt: 100,
        updatedAt: 100,
      });
      expect(store.get("p1")).toEqual(saved);
    });

    it("creates a jailbreak prompt when kind is set", () => {
      const store = makeStore();
      const saved = store.create({
        id: "j1",
        title: "DAN",
        content: "You are DAN.",
        kind: "jailbreak",
        now: 100,
      });
      expect(saved.kind).toBe("jailbreak");
      expect(store.get("j1")?.kind).toBe("jailbreak");
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

    it("list(kind) filters to only that kind", () => {
      const store = makeStore();
      store.create({ id: "p1", title: "P1", content: "p1", now: 100 });
      store.create({ id: "j1", title: "J1", content: "j1", kind: "jailbreak", now: 200 });
      store.create({ id: "p2", title: "P2", content: "p2", now: 300 });
      expect(store.list("persona").map((p) => p.id)).toEqual(["p2", "p1"]);
      expect(store.list("jailbreak").map((p) => p.id)).toEqual(["j1"]);
    });

    it("update changes title/content and bumps updatedAt", () => {
      const store = makeStore();
      store.create({ id: "p1", title: "Pirate", content: "Talk like a pirate.", now: 100 });
      store.update("p1", { title: "Pirate v2", content: "Talk like a pirate, arr." }, 200);
      expect(store.get("p1")).toEqual({
        id: "p1",
        title: "Pirate v2",
        content: "Talk like a pirate, arr.",
        kind: "persona",
        createdAt: 100,
        updatedAt: 200,
      });
    });

    it("update is a no-op for an unknown id", () => {
      const store = makeStore();
      store.update("missing", { title: "x", content: "y" }, 200);
      expect(store.get("missing")).toBeUndefined();
    });

    it("setKind flips a prompt between persona and jailbreak", () => {
      const store = makeStore();
      store.create({ id: "p1", title: "Pirate", content: "Talk like a pirate.", now: 100 });
      store.setKind("p1", "jailbreak", 200);
      expect(store.get("p1")?.kind).toBe("jailbreak");
      expect(store.get("p1")?.updatedAt).toBe(200);
      store.setKind("p1", "persona", 300);
      expect(store.get("p1")?.kind).toBe("persona");
    });

    it("setKind is a no-op for an unknown id", () => {
      const store = makeStore();
      store.setKind("missing", "jailbreak", 200);
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
