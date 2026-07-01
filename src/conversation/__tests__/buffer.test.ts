import { ConversationBuffer, TurnRole, type Turn } from "../index";

function turn(id: string, content: string, index: number): Turn {
  return { id, role: TurnRole.USER, content, index };
}

describe("ConversationBuffer", () => {
  it("appends and reads back in order", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "hello", 0));
    b.append(turn("t2", "world", 1));
    expect(b.size()).toBe(2);
    expect(b.all().map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(b.get("t1")?.content).toBe("hello");
  });

  it("rejects duplicate turn ids", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "x", 0));
    expect(() => b.append(turn("t1", "y", 1))).toThrow(/duplicate/);
  });

  it("pendingTurns returns everything before any markProcessed", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "a", 0));
    b.append(turn("t2", "b", 1));
    expect(b.pendingTurns().map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("markProcessed advances the high-water mark", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "a", 0));
    b.append(turn("t2", "b", 1));
    b.append(turn("t3", "c", 2));
    expect(b.markProcessed("t2")).toBe(2);
    expect(b.processedCount()).toBe(2);
    expect(b.pendingTurns().map((t) => t.id)).toEqual(["t3"]);
  });

  it("markProcessed never goes backwards", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "a", 0));
    b.append(turn("t2", "b", 1));
    b.markProcessed("t2");
    b.markProcessed("t1");
    expect(b.processedCount()).toBe(2);
  });

  it("markProcessed on unknown id is a no-op", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "a", 0));
    b.markProcessed("missing");
    expect(b.processedCount()).toBe(0);
  });

  it("late-arriving turn after a mark still shows as pending", () => {
    const b = new ConversationBuffer();
    b.append(turn("t1", "a", 0));
    b.markProcessed("t1");
    b.append(turn("t2", "b", 1));
    expect(b.pendingTurns().map((t) => t.id)).toEqual(["t2"]);
  });

  describe("contextBefore", () => {
    it("returns every turn strictly before the given id", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));
      b.append(turn("t2", "b", 1));
      b.append(turn("t3", "c", 2));

      expect(b.contextBefore("t3").map((t) => t.id)).toEqual(["t1", "t2"]);
      expect(b.contextBefore("t1")).toEqual([]);
    });

    it("excludes turns already summarized", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));
      b.append(turn("t2", "b", 1));
      b.append(turn("t3", "c", 2));
      b.markSummarized(["t1"]);

      expect(b.contextBefore("t3").map((t) => t.id)).toEqual(["t2"]);
    });

    it("returns [] for an unknown turn id", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));
      expect(b.contextBefore("missing")).toEqual([]);
    });
  });

  describe("truncateFrom", () => {
    it("removes the given turn and everything after it, returning the removed turns in order", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));
      b.append(turn("t2", "b", 1));
      b.append(turn("t3", "c", 2));

      const removed = b.truncateFrom("t2");

      expect(removed.map((t) => t.id)).toEqual(["t2", "t3"]);
      expect(b.all().map((t) => t.id)).toEqual(["t1"]);
      expect(b.size()).toBe(1);
      expect(b.get("t2")).toBeUndefined();
    });

    it("is a no-op returning [] for an unknown turn id", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));

      expect(b.truncateFrom("missing")).toEqual([]);
      expect(b.size()).toBe(1);
    });

    it("clamps the high-water mark when the removed turns were already processed", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));
      b.append(turn("t2", "b", 1));
      b.markProcessed("t2");

      b.truncateFrom("t2");

      expect(b.processedCount()).toBe(1);
    });

    it("clears summarized marks for removed turns", () => {
      const b = new ConversationBuffer();
      b.append(turn("t1", "a", 0));
      b.append(turn("t2", "b", 1));
      b.markSummarized(["t1", "t2"]);

      b.truncateFrom("t2");

      expect(b.isSummarized("t1")).toBe(true);
      expect(b.isSummarized("t2")).toBe(false);
    });
  });
});
