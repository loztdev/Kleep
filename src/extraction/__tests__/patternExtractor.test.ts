import { MemoryKind, Network } from "../../schema";
import { TurnRole, type Turn } from "../../conversation";
import { PatternExtractor } from "../patternExtractor";

function turn(content: string, id = "t1", index = 0): Turn {
  return { id, role: TurnRole.USER, content, index };
}

const ex = new PatternExtractor();

describe("PatternExtractor", () => {
  it("extracts an entity from 'X is a Y.'", () => {
    const out = ex.extract(turn("Mojo is a puppy."));
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("entity");
    if (out[0]!.type === "entity") {
      expect(out[0]!.entity_id).toBe("char:mojo");
      expect(out[0]!.canonical_name).toBe("Mojo");
      expect(out[0]!.entity_type).toBe("puppy");
      expect(out[0]!.network).toBe(Network.OBSERVATION);
      expect(out[0]!.quote).toBe("Mojo is a puppy.");
    }
  });

  it("extracts a location fact from 'X is at Y.'", () => {
    const out = ex.extract(turn("Mojo is at Park."));
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f.type).toBe("atomic");
    if (f.type === "atomic") {
      expect(f.kind).toBe(MemoryKind.FACT);
      expect(f.network).toBe(Network.EXPERIENCE);
      expect(f.entity_ids).toEqual(["Mojo", "Park"]);
    }
  });

  it("extracts a possession fact from 'X has Y.'", () => {
    const out = ex.extract(turn("Mojo has a red collar."));
    expect(out).toHaveLength(1);
    const f = out[0]!;
    if (f.type === "atomic") {
      expect(f.kind).toBe(MemoryKind.FACT);
      expect(f.content).toContain("red collar");
      expect(f.entity_ids).toEqual(["Mojo"]);
    }
  });

  it("extracts an opinion with viewpoint_holder", () => {
    const out = ex.extract(turn("Alice thinks the king is weak."));
    expect(out).toHaveLength(1);
    const f = out[0]!;
    if (f.type === "atomic") {
      expect(f.kind).toBe(MemoryKind.OPINION);
      expect(f.network).toBe(Network.OPINION);
      expect(f.viewpoint_holder).toBe("Alice");
    }
  });

  it("extracts multiple facts from one turn", () => {
    const out = ex.extract(
      turn("Mojo is a puppy. Mojo is at Park. Alice thinks Mojo is cute."),
    );
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it("returns nothing when no pattern matches", () => {
    expect(ex.extract(turn("a quiet wind passes by"))).toEqual([]);
  });

  it("quote is always a verbatim substring of the turn", () => {
    const t = turn("Mojo is a puppy. Mojo is at Park.");
    for (const f of ex.extract(t)) {
      expect(t.content.includes(f.quote)).toBe(true);
    }
  });

  it("custom confidence flows through", () => {
    const lo = new PatternExtractor({ confidence: 0.3 });
    const out = lo.extract(turn("Mojo is a puppy."));
    expect(out[0]!.confidence).toBe(0.3);
  });
});
