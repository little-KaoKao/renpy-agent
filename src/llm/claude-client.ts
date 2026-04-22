import Anthropic from '@anthropic-ai/sdk';
import type { LlmChatParams, LlmClient, LlmResponse } from './types.js';

export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_DEFAULT_MAX_TOKENS = 4096;

export interface ClaudeLlmClientOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly client?: Pick<Anthropic, 'messages'>;
}

export class ClaudeLlmClient implements LlmClient {
  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly model: string;

  constructor(options: ClaudeLlmClientOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY not set. Add it to .env or pass apiKey explicitly.',
        );
      }
      this.client = new Anthropic({ apiKey });
    }
    this.model = options.model ?? CLAUDE_DEFAULT_MODEL;
  }

  async chat(params: LlmChatParams): Promise<LlmResponse> {
    const systemParts: string[] = [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of params.messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    if (messages.length === 0) {
      throw new Error('chat() requires at least one user/assistant message.');
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? CLAUDE_DEFAULT_MAX_TOKENS,
      temperature: params.temperature,
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      messages,
    });

    const textBlocks = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text);
    const content = textBlocks.join('');

    return {
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

export function extractJsonBlock(response: string): string {
  const fenceMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }
  const trimmed = response.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  throw new Error('LLM response did not contain a JSON block');
}
