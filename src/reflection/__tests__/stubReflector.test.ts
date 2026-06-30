import { MemoryKind, Network } from "../../schema";
import {
  makeFact,
  makeOpinion,
} from "../../storage/__tests__/fixtures";
import { StubReflector } from "../stubReflector";

describe("StubReflector — contradiction detection", () => {
  it("flags two negation-style opinions on the same entity", () => {
    const a = makeOpinion("alice", {
      content: "The king is strong.",
      entity_ids: ["king"],
    });
    const b = makeOpinion("bob", {
      content: "The king is not strong.",
      entity_ids: ["king"],
    });
    const findings = new StubReflector().reflect({
      opinions: [a, b],
      facts: [],
      entries: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("contradiction");
    expect(findings[0]!.primary_asset_id).toBe(a.id);
    expect(findings[0]!.supporting_asset_ids).toEqual([b.id]);
  });

  it("does not flag two opinions from the same viewpoint", () => {
    const a = makeOpinion("alice", {
      content: "The king is strong.",
      entity_ids: ["king"],
    });
    const b = makeOpinion("alice", {
      content: "The king is not strong.",
      entity_ids: ["king"],
    });
    const findings = new StubReflector().reflect({
      opinions: [a, b],
      facts: [],
      entries: [],
    });
    expect(findings).toHaveLength(0);
  });

  it("does not flag two non-negating opinions even on the same entity", () => {
    const a = makeOpinion("alice", {
      content: "The king is strong.",
      entity_ids: ["king"],
    });
    const b = makeOpinion("bob", {
      content: "The king is wise.",
      entity_ids: ["king"],
    });
    const findings = new StubReflector().reflect({
      opinions: [a, b],
      facts: [],
      entries: [],
    });
    expect(findings.find((f) => f.kind === "contradiction")).toBeUndefined();
  });

  it("does not cross entities", () => {
    const a = makeOpinion("alice", {
      content: "The king is strong.",
      entity_ids: ["king"],
    });
    const b = makeOpinion("bob", {
      content: "The queen is not strong.",
      entity_ids: ["queen"],
    });
    const findings = new StubReflector().reflect({
      opinions: [a, b],
      facts: [],
      entries: [],
    });
    expect(findings).toHaveLength(0);
  });
});

describe("StubReflector — corroboration", () => {
  it("flags an opinion whose normalized content matches a fact", () => {
    const op = makeOpinion("alice", {
      content: "Mojo is at Park.",
      entity_ids: ["Mojo", "Park"],
      network: Network.OPINION,
    });
    const fact = makeFact({
      content: "Mojo is at Park.",
      kind: MemoryKind.FACT,
      network: Network.EXPERIENCE,
      entity_ids: ["Mojo", "Park"],
    });
    const findings = new StubReflector().reflect({
      opinions: [op],
      facts: [fact],
      entries: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("corroboration");
    expect(findings[0]!.effect).toEqual({
      type: "adjust_confidence",
      delta: +0.1,
    });
  });

  it("does not corroborate when no fact matches", () => {
    const op = makeOpinion("alice", { content: "The sky is green." });
    const findings = new StubReflector().reflect({
      opinions: [op],
      facts: [],
      entries: [],
    });
    expect(findings.find((f) => f.kind === "corroboration")).toBeUndefined();
  });
});
