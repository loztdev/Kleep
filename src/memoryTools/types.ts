/**
 * Generic tool-execution contracts. Every `LlmToolDefinition` shipped to the
 * model needs a paired executor these types describe — the `generateReply`
 * loop calls `execute(input)` when the model invokes the tool and threads
 * the result back for the next round. Kept in a shared module so adding a
 * second tool (retrieve, link, etc.) doesn't force an import from an
 * unrelated tool-specific file.
 */

import type { LlmToolDefinition } from "../llm/types";

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

export type ToolExecutor = (input: unknown) => Promise<ToolExecutionResult>;

export interface ToolRegistration {
  definition: LlmToolDefinition;
  execute: ToolExecutor;
}
