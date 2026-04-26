import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type {
  LlmChatParams,
  LlmClient,
  LlmContentBlock,
  LlmResponse,
  LlmStopReason,
  LlmToolChatParams,
  LlmToolChatResponse,
} from './types.js';

export const CLAUDE_DIRECT_DEFAULT_MODEL = 'claude-sonnet-4-6';
export const CLAUDE_BEDROCK_DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-6';
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
      this.client = new AnthropicBedrock({
        awsRegion,
        apiKey,
        maxRetries: 4,
      }) as unknown as MessagesClient;
    } else {
      const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY not set. Either set it for direct Anthropic, or set CLAUDE_CODE_USE_BEDROCK=1 for AWS Bedrock.',
        );
      }
      this.client = new Anthropic({ apiKey, maxRetries: 4 });
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

  async chatWithTools(params: LlmToolChatParams): Promise<LlmToolChatResponse> {
    const systemParts: string[] = [];
    const messages: Anthropic.MessageParam[] = [];
    for (const m of params.messages) {
      if (m.role === 'system') {
        if (typeof m.content !== 'string') {
          throw new Error('chatWithTools(): system messages must have string content.');
        }
        systemParts.push(m.content);
        continue;
      }
      messages.push({
        role: m.role,
        content: translateMessageContent(m.content),
      });
    }
    if (messages.length === 0) {
      throw new Error('chatWithTools() requires at least one user/assistant message.');
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? CLAUDE_DEFAULT_MAX_TOKENS,
      temperature: params.temperature,
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      messages,
    });

    const content: LlmContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    return {
      content,
      stopReason: (response.stop_reason ?? 'end_turn') as LlmStopReason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

function translateMessageContent(
  content: LlmToolChatParams['messages'][number]['content'],
): string | Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return content;
  return content.map((block): Anthropic.ContentBlockParam => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
    return {
      type: 'tool_result',
      tool_use_id: block.toolUseId,
      content: block.content,
      ...(block.isError ? { is_error: true } : {}),
    };
  });
}

/**
 * @deprecated v0.7: pipeline stages now use `chatWithTools` + structured tool
 * inputs, so JSON fence extraction is no longer needed. External callers that
 * still parse free-form LLM JSON may keep using this; it will be removed in v0.8.
 */
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
