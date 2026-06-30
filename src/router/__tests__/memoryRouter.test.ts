import { MemoryKind, Network } from "../../schema";
import {
  InMemoryStructuredStore,
  InMemoryVectorStore,
} from "../../storage";
import {
  makeEntry,
  makeFact,
  makeLore,
  makeOpinion,
} from "../../storage/__tests__/fixtures";
import { MemoryRouter } from "../memoryRouter";
import { NetworkRuleViolation } from "../networkRules";

function makeRouter() {
  return {
    router: new MemoryRouter(
      new InMemoryStructuredStore(),
      new InMemoryVectorStore(),
    ),
  };
}

describe("MemoryRouter.write — dispatch", () => {
  it("routes FACT to the structured store", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    const fact = makeFact();
    router.write(fact);
    expect(structured.size()).toBe(1);
    expect(vector.size()).toBe(0);
  });

  it("routes WorldBibleEntry to the structured store via putEntry", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    const entry = makeEntry("char:mojo");
    router.write(entry);
    expect(structured.getEntry("char:mojo")).toEqual(entry);
    expect(vector.size()).toBe(0);
  });

  it("routes LoreSnippet to the vector store", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    const lore = makeLore([1, 0, 0]);
    router.write(lore);
    expect(vector.size()).toBe(1);
    expect(structured.size()).toBe(0);
  });

  it("routes OPINION to the structured store", () => {
    const structured = new InMemoryStructuredStore();
    const vector = new InMemoryVectorStore();
    const router = new MemoryRouter(structured, vector);
    router.write(makeOpinion("alice"));
    expect(structured.size()).toBe(1);
    expect(vector.size()).toBe(0);
  });
});

describe("MemoryRouter.write — isolation rules", () => {
  it("refuses a RULE in OPINION network", () => {
    const { router } = makeRouter();
    const bogus = makeFact({
      kind: MemoryKind.RULE,
      network: Network.WORLD, // pass schema, then poke
    });
    const violating = { ...bogus, network: Network.OPINION };
    expect(() => router.write(violating as never)).toThrow(
      NetworkRuleViolation,
    );
  });

  it("refuses a FACT in OPINION network", () => {
    const { router } = makeRouter();
    const f = makeFact();
    const violating = { ...f, network: Network.OPINION };
    expect(() => router.write(violating as never)).toThrow(
      NetworkRuleViolation,
    );
  });

  it("refuses an OPINION-kind in WORLD network", () => {
    const { router } = makeRouter();
    const o = makeOpinion("alice");
    const violating = { ...o, network: Network.WORLD };
    expect(() => router.write(violating as never)).toThrow(
      NetworkRuleViolation,
    );
  });
});

describe("MemoryRouter.query — scoped reads", () => {
  it("network filter keeps OPINION out of WORLD reads", () => {
    const { router } = makeRouter();
    router.write(makeEntry("e1"));
    router.write(makeFact({ network: Network.WORLD }));
    router.write(makeOpinion("alice"));
    const out = router.query({ network: Network.WORLD });
    expect(out.every((a) => a.network === Network.WORLD)).toBe(true);
    expect(out.some((a) => a.network === Network.OPINION)).toBe(false);
  });

  it("viewpoint scoping isolates opinions per holder", () => {
    const { router } = makeRouter();
    router.write(makeOpinion("alice"));
    router.write(makeOpinion("alice"));
    router.write(makeOpinion("bob"));
    const aliceOnly = router.query({
      network: Network.OPINION,
      viewpoint_holder: "alice",
    });
    expect(aliceOnly).toHaveLength(2);
    expect(aliceOnly.every((a) => a.viewpoint_holder === "alice")).toBe(true);
  });

  it("multi-network filter unions correctly", () => {
    const { router } = makeRouter();
    router.write(makeEntry("e1"));
    router.write(makeFact({ network: Network.EXPERIENCE }));
    router.write(makeOpinion("alice"));
    const out = router.query({
      network: [Network.WORLD, Network.EXPERIENCE],
    });
    expect(out).toHaveLength(2);
    expect(out.every((a) => a.network !== Network.OPINION)).toBe(true);
  });
});

describe("MemoryRouter.semanticQuery", () => {
  it("scopes vector results by network filter", () => {
    const { router } = makeRouter();
    const worldLore = makeLore([1, 0], { network: Network.WORLD });
    const aliceLore = makeLore([1, 0], {
      network: Network.OPINION,
      viewpoint_holder: "alice",
    });
    router.write(worldLore);
    router.write(aliceLore);
    const out = router.semanticQuery([1, 0], 5, {
      network: Network.WORLD,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.snippet.id).toBe(worldLore.id);
  });

  it("scopes vector results by viewpoint_holder", () => {
    const { router } = makeRouter();
    router.write(
      makeLore([1, 0], {
        network: Network.OPINION,
        viewpoint_holder: "alice",
      }),
    );
    router.write(
      makeLore([1, 0], {
        network: Network.OPINION,
        viewpoint_holder: "bob",
      }),
    );
    const out = router.semanticQuery([1, 0], 5, {
      viewpoint_holder: "alice",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.snippet.viewpoint_holder).toBe("alice");
  });
});

describe("MemoryRouter.read / delete", () => {
  it("reads from either store by id", () => {
    const { router } = makeRouter();
    const f = makeFact();
    const l = makeLore([1, 0]);
    router.write(f);
    router.write(l);
    expect(router.read(f.id)?.id).toBe(f.id);
    expect(router.read(l.id)?.id).toBe(l.id);
    expect(router.read("missing")).toBeUndefined();
  });

  it("delete removes from whichever store holds the id", () => {
    const { router } = makeRouter();
    const f = makeFact();
    const l = makeLore([1, 0]);
    router.write(f);
    router.write(l);
    expect(router.delete(f.id)).toBe(true);
    expect(router.delete(l.id)).toBe(true);
    expect(router.delete("missing")).toBe(false);
  });
});
