import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type { LlmChatParams, LlmClient, LlmResponse } from './types.js';

export const CLAUDE_DIRECT_DEFAULT_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_BEDROCK_DEFAULT_MODEL = 'anthropic.claude-sonnet-4-5-20250929-v1:0';
export const CLAUDE_DEFAULT_MAX_TOKENS = 4096;

/** @deprecated kept for backward compat; prefer the direct/bedrock-specific constants */
export const CLAUDE_DEFAULT_MODEL = CLAUDE_DIRECT_DEFAULT_MODEL;

export type ClaudeTransportMode = 'bedrock' | 'direct';

export interface MessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface ClaudeLlmClientOptions {
  readonly mode?: ClaudeTransportMode;
  readonly apiKey?: string;
  readonly awsRegion?: string;
  readonly model?: string;
  readonly client?: MessagesClient;
}

export function resolveClaudeMode(env: NodeJS.ProcessEnv = process.env): ClaudeTransportMode {
  return env.CLAUDE_CODE_USE_BEDROCK === '1' ? 'bedrock' : 'direct';
}

export class ClaudeLlmClient implements LlmClient {
  readonly mode: ClaudeTransportMode;
  private readonly client: MessagesClient;
  private readonly model: string;

  constructor(options: ClaudeLlmClientOptions = {}) {
    this.mode = options.mode ?? resolveClaudeMode();

    if (options.client) {
      this.client = options.client;
    } else if (this.mode === 'bedrock') {
      const awsRegion = options.awsRegion ?? process.env.AWS_REGION;
      if (!awsRegion) {
        throw new Error(
          'AWS_REGION not set. Required when CLAUDE_CODE_USE_BEDROCK=1; export AWS_REGION="us-east-1" (or your region).',
        );
      }
      const apiKey = options.apiKey ?? process.env.AWS_BEARER_TOKEN_BEDROCK;
      if (!apiKey && !process.env.AWS_ACCESS_KEY_ID) {
        throw new Error(
          'Bedrock credentials missing. Set AWS_BEARER_TOKEN_BEDROCK (bearer token) or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.',
        );
      }
      this.client = new AnthropicBedrock({ awsRegion, apiKey }) as unknown as MessagesClient;
    } else {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY not set. Either set it for direct Anthropic, or set CLAUDE_CODE_USE_BEDROCK=1 for AWS Bedrock.',
        );
      }
      this.client = new Anthropic({ apiKey });
    }

    this.model =
      options.model ??
      process.env.CLAUDE_MODEL ??
      (this.mode === 'bedrock' ? CLAUDE_BEDROCK_DEFAULT_MODEL : CLAUDE_DIRECT_DEFAULT_MODEL);
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
