/**
 * Re-export of the provider-agnostic Zod→JSON-schema converter — kept here
 * so existing `src/claude` imports don't need to change. See
 * `src/llm/zodToJsonSchema.ts` for the implementation; it moved there
 * because the conversion itself has nothing Anthropic-specific about it
 * (`OpenRouterClient.structured()` uses the exact same function).
 */
export { type ToolInputSchema, zodToToolInputSchema } from "../llm/zodToJsonSchema";
