/**
 * Tier 4.9 — CARA reflection public surface.
 */

export type {
  Reflector,
  ReflectionEffect,
  ReflectionFinding,
  ReflectionFindingKind,
  ReflectionInput,
} from "./types";
export { StubReflector } from "./stubReflector";
export {
  ReflectionEngine,
  type ReflectionEngineOptions,
  type ReflectionTickResult,
} from "./reflectionEngine";
