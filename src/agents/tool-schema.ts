// Shared tool-schema / tool-executor types used by every POC's tools.ts and
// by the Executer loop (M4). One tool = one LlmToolSchema (what the LLM sees)
// + one ToolExecutor (what the host runs when the LLM emits a tool_use block).

import type { LlmToolSchema } from '../llm/types.js';
import type { CommonToolContext } from './common-tools.js';

export type ToolResult = Record<string, unknown>;

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: CommonToolContext,
) => Promise<ToolResult>;

export interface PocToolSet {
  readonly schemas: ReadonlyArray<LlmToolSchema>;
  readonly executors: Readonly<Record<string, ToolExecutor>>;
}

/** v0.6 stub factory — use this for every Tier 2 tool until v0.7 wires it in. */
export function stubTool(name: string, description: string): {
  schema: LlmToolSchema;
  executor: ToolExecutor;
} {
  return {
    schema: {
      name,
      description,
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    },
    executor: async () => ({ error: `${name}: v0.6 not yet routed through v5` }),
  };
}
