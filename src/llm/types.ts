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

export interface LlmClient {
  chat(params: LlmChatParams): Promise<LlmResponse>;
}
