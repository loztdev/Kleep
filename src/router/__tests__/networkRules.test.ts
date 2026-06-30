import { MemoryKind, Network } from "../../schema";
import {
  NetworkRuleViolation,
  allowedNetworks,
  assertAllowed,
  isAllowed,
} from "../networkRules";

describe("networkRules", () => {
  describe("isAllowed / allowedNetworks", () => {
    it("RULE only allowed in WORLD", () => {
      expect(allowedNetworks(MemoryKind.RULE)).toEqual([Network.WORLD]);
      expect(isAllowed(MemoryKind.RULE, Network.WORLD)).toBe(true);
      expect(isAllowed(MemoryKind.RULE, Network.EXPERIENCE)).toBe(false);
      expect(isAllowed(MemoryKind.RULE, Network.OBSERVATION)).toBe(false);
      expect(isAllowed(MemoryKind.RULE, Network.OPINION)).toBe(false);
    });

    it("ENTITY allowed in WORLD or OBSERVATION", () => {
      expect(isAllowed(MemoryKind.ENTITY, Network.WORLD)).toBe(true);
      expect(isAllowed(MemoryKind.ENTITY, Network.OBSERVATION)).toBe(true);
      expect(isAllowed(MemoryKind.ENTITY, Network.OPINION)).toBe(false);
      expect(isAllowed(MemoryKind.ENTITY, Network.EXPERIENCE)).toBe(false);
    });

    it("FACT never goes to OPINION", () => {
      expect(isAllowed(MemoryKind.FACT, Network.WORLD)).toBe(true);
      expect(isAllowed(MemoryKind.FACT, Network.EXPERIENCE)).toBe(true);
      expect(isAllowed(MemoryKind.FACT, Network.OBSERVATION)).toBe(true);
      expect(isAllowed(MemoryKind.FACT, Network.OPINION)).toBe(false);
    });

    it("OPINION only in OPINION", () => {
      expect(allowedNetworks(MemoryKind.OPINION)).toEqual([Network.OPINION]);
      expect(isAllowed(MemoryKind.OPINION, Network.OPINION)).toBe(true);
      expect(isAllowed(MemoryKind.OPINION, Network.WORLD)).toBe(false);
    });

    it("LORE / SUMMARY / REFLECTION allowed everywhere", () => {
      for (const kind of [
        MemoryKind.LORE,
        MemoryKind.SUMMARY,
        MemoryKind.REFLECTION,
      ]) {
        for (const net of [
          Network.WORLD,
          Network.EXPERIENCE,
          Network.OBSERVATION,
          Network.OPINION,
        ]) {
          expect(isAllowed(kind, net)).toBe(true);
        }
      }
    });
  });

  describe("assertAllowed", () => {
    it("passes silently when allowed", () => {
      expect(() => assertAllowed(MemoryKind.FACT, Network.WORLD)).not.toThrow();
    });

    it("throws NetworkRuleViolation when disallowed", () => {
      expect(() => assertAllowed(MemoryKind.RULE, Network.OPINION)).toThrow(
        NetworkRuleViolation,
      );
    });

    it("violation carries kind and network metadata", () => {
      try {
        assertAllowed(MemoryKind.OPINION, Network.WORLD);
        fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(NetworkRuleViolation);
        const v = e as NetworkRuleViolation;
        expect(v.kind).toBe(MemoryKind.OPINION);
        expect(v.network).toBe(Network.WORLD);
      }
    });
  });
});
