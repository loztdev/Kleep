/**
 * Shared behavioral contract for every `SkillStore` implementation — run
 * against both `InMemorySkillStore` and `SqliteSkillStore` so they're
 * guaranteed to agree.
 */

import type { SkillStore } from "../types";

export function describeSkillStoreContract(name: string, makeStore: () => SkillStore): void {
  describe(name, () => {
    const seed = {
      id: "s1",
      name: "Skill Authoring",
      description: "Guide for creating well-structured skills",
      whenToUse: "When the user wants to author or refine a skill",
      body: "Skills carry name, description, whenToUse, and body...",
      now: 100,
    };

    it("creates and gets a skill by id", () => {
      const store = makeStore();
      const saved = store.create(seed);
      expect(saved).toEqual({
        id: "s1",
        name: "Skill Authoring",
        description: "Guide for creating well-structured skills",
        whenToUse: "When the user wants to author or refine a skill",
        body: "Skills carry name, description, whenToUse, and body...",
        createdAt: 100,
        updatedAt: 100,
      });
      expect(store.get("s1")).toEqual(saved);
    });

    it("get returns undefined for an unknown id", () => {
      const store = makeStore();
      expect(store.get("missing")).toBeUndefined();
    });

    it("lists skills most-recently-updated first", () => {
      const store = makeStore();
      store.create({ ...seed, id: "old", now: 100 });
      store.create({ ...seed, id: "new", now: 200 });
      expect(store.list().map((s) => s.id)).toEqual(["new", "old"]);
      store.update("old", { name: "Old", description: "d", whenToUse: "w", body: "b" }, 300);
      expect(store.list().map((s) => s.id)).toEqual(["old", "new"]);
    });

    it("breaks updatedAt ties deterministically by id", () => {
      const store = makeStore();
      store.create({ ...seed, id: "b", now: 100 });
      store.create({ ...seed, id: "a", now: 100 });
      expect(store.list().map((s) => s.id)).toEqual(["a", "b"]);
    });

    it("update changes every field and bumps updatedAt", () => {
      const store = makeStore();
      store.create(seed);
      store.update(
        "s1",
        {
          name: "Skill Authoring v2",
          description: "Updated summary",
          whenToUse: "New trigger",
          body: "New body",
        },
        200,
      );
      expect(store.get("s1")).toEqual({
        id: "s1",
        name: "Skill Authoring v2",
        description: "Updated summary",
        whenToUse: "New trigger",
        body: "New body",
        createdAt: 100,
        updatedAt: 200,
      });
    });

    it("update is a no-op for an unknown id", () => {
      const store = makeStore();
      store.update(
        "missing",
        { name: "x", description: "y", whenToUse: "z", body: "b" },
        200,
      );
      expect(store.get("missing")).toBeUndefined();
    });

    it("delete removes a skill and returns true, false if already gone", () => {
      const store = makeStore();
      store.create(seed);
      expect(store.delete("s1")).toBe(true);
      expect(store.get("s1")).toBeUndefined();
      expect(store.delete("s1")).toBe(false);
    });

    it("list on an empty store returns []", () => {
      const store = makeStore();
      expect(store.list()).toEqual([]);
    });
  });
}
