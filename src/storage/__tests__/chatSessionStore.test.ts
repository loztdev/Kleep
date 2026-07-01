import { TurnRole, type Turn } from "../../conversation";
import { newId } from "../../schema";
import { ChatSessionStore } from "../chatSessionStore";
import { openTestDatabase } from "./betterSqliteAdapter";

function turn(id: string, index: number, content = "hi"): Turn {
  return { id, role: index % 2 === 0 ? TurnRole.USER : TurnRole.ASSISTANT, content, index };
}

describe("ChatSessionStore", () => {
  it("creates a session and lists it back", () => {
    const store = new ChatSessionStore(openTestDatabase());
    const meta = store.createSession({
      id: "s1",
      title: "New chat",
      providerKind: "openrouter",
      model: "z-ai/glm-5.2",
      now: 100,
    });
    expect(meta).toEqual({
      id: "s1",
      title: "New chat",
      providerKind: "openrouter",
      model: "z-ai/glm-5.2",
      createdAt: 100,
      updatedAt: 100,
    });
    expect(store.listSessions()).toEqual([meta]);
  });

  it("getSession returns undefined for an unknown id", () => {
    const store = new ChatSessionStore(openTestDatabase());
    expect(store.getSession("missing")).toBeUndefined();
  });

  it("lists sessions most-recently-updated first", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "old", title: "Old", providerKind: "claude", now: 100 });
    store.createSession({ id: "new", title: "New", providerKind: "claude", now: 200 });
    expect(store.listSessions().map((s) => s.id)).toEqual(["new", "old"]);
    store.touchSession("old", 300);
    expect(store.listSessions().map((s) => s.id)).toEqual(["old", "new"]);
  });

  it("round-trips turns in order via loadSession", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0, "hello"), 101);
    store.appendTurn("s1", turn("t2", 1, "hi there"), 102);

    const loaded = store.loadSession("s1");
    expect(loaded.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(loaded.processedCount).toBe(0);
    expect(loaded.summarizedTurnIds).toEqual([]);
  });

  it("appendTurn bumps the session's updated_at", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 500);
    expect(store.getSession("s1")?.updatedAt).toBe(500);
  });

  it("truncateFrom deletes the turn and everything after it", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);
    store.appendTurn("s1", turn("t2", 1), 100);
    store.appendTurn("s1", turn("t3", 2), 100);

    store.truncateFrom("s1", "t2");

    expect(store.loadSession("s1").turns.map((t) => t.id)).toEqual(["t1"]);
  });

  it("truncateFrom is a no-op for an unknown turn id", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);
    store.truncateFrom("s1", "missing");
    expect(store.loadSession("s1").turns).toHaveLength(1);
  });

  it("persists the processed-turn high-water mark", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);
    store.updateProcessedCount("s1", 1);
    expect(store.loadSession("s1").processedCount).toBe(1);
  });

  it("persists which turns are summarized", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);
    store.appendTurn("s1", turn("t2", 1), 100);
    store.markSummarized("s1", ["t1"]);
    expect(store.loadSession("s1").summarizedTurnIds).toEqual(["t1"]);
  });

  it("renameSession updates the title and bumps updated_at", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.renameSession("s1", "Renamed", 200);
    const meta = store.getSession("s1");
    expect(meta?.title).toBe("Renamed");
    expect(meta?.updatedAt).toBe(200);
  });

  it("deleteSession removes the session and its turns", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);
    store.deleteSession("s1");
    expect(store.getSession("s1")).toBeUndefined();
    expect(store.loadSession("s1").turns).toEqual([]);
  });

  it("omits model when not provided", () => {
    const store = new ChatSessionStore(openTestDatabase());
    const meta = store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    expect(meta.model).toBeUndefined();
    expect(store.getSession("s1")?.model).toBeUndefined();
  });

  it("replaceFrom truncates and inserts the new turns in one transaction", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);
    store.appendTurn("s1", turn("t2", 1), 100);
    store.appendTurn("s1", turn("t3", 2), 100);

    store.replaceFrom("s1", "t2", [turn("t2b", 1, "regenerated")], 500);

    const loaded = store.loadSession("s1");
    expect(loaded.turns.map((t) => t.id)).toEqual(["t1", "t2b"]);
    expect(store.getSession("s1")?.updatedAt).toBe(500);
  });

  it("replaceFrom is a no-op truncate for an unknown turn id, still inserts new turns", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({ id: "s1", title: "Chat", providerKind: "claude", now: 100 });
    store.appendTurn("s1", turn("t1", 0), 100);

    store.replaceFrom("s1", "missing", [turn("t2", 1)], 500);

    expect(store.loadSession("s1").turns.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("updateProviderMeta corrects provider/model without bumping updated_at", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({
      id: "s1",
      title: "Chat",
      providerKind: "claude",
      model: "opus",
      now: 100,
    });
    store.updateProviderMeta("s1", "openrouter", "z-ai/glm-5.2");
    const meta = store.getSession("s1");
    expect(meta?.providerKind).toBe("openrouter");
    expect(meta?.model).toBe("z-ai/glm-5.2");
    expect(meta?.updatedAt).toBe(100);
  });

  it("updateProviderMeta clears model when omitted", () => {
    const store = new ChatSessionStore(openTestDatabase());
    store.createSession({
      id: "s1",
      title: "Chat",
      providerKind: "claude",
      model: "opus",
      now: 100,
    });
    store.updateProviderMeta("s1", "openrouter");
    expect(store.getSession("s1")?.model).toBeUndefined();
  });

  it("returns unique ids passed through newId() without collision", () => {
    const store = new ChatSessionStore(openTestDatabase());
    const a = store.createSession({ id: newId(), title: "A", providerKind: "claude", now: 100 });
    const b = store.createSession({ id: newId(), title: "B", providerKind: "claude", now: 100 });
    expect(a.id).not.toBe(b.id);
  });
});
