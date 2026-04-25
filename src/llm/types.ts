export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmResponse {
  readonly content: string;
  readonly usage: LlmUsage;
}

export interface LlmChatParams {
  readonly messages: ReadonlyArray<LlmMessage>;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

// ── Tool-use types (V5) ──────────────────────────────────────────────

export interface LlmTextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface LlmToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface LlmToolResultBlock {
  readonly type: 'tool_result';
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock;

export type LlmAssistantContent = string | ReadonlyArray<LlmTextBlock | LlmToolUseBlock>;
export type LlmUserContent = string | ReadonlyArray<LlmTextBlock | LlmToolResultBlock>;

export interface LlmToolMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | ReadonlyArray<LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock>;
}

export interface LlmToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type LlmStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal';

export interface LlmToolChatParams {
  readonly messages: ReadonlyArray<LlmToolMessage>;
  readonly tools: ReadonlyArray<LlmToolSchema>;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface LlmToolChatResponse {
  readonly content: ReadonlyArray<LlmContentBlock>;
  readonly stopReason: LlmStopReason;
  readonly usage: LlmUsage;
}

export interface LlmClient {
  chat(params: LlmChatParams): Promise<LlmResponse>;
  chatWithTools?(params: LlmToolChatParams): Promise<LlmToolChatResponse>;
}
