import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import type {
  LlmChatParams,
  LlmClient,
  LlmContentBlock,
  LlmMessage,
  LlmResponse,
  LlmStopReason,
  LlmToolChatParams,
  LlmToolChatResponse,
  LlmToolMessage,
  LlmUsage,
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

// Anthropic 的 prompt cache 起步是 ~1024 token(Sonnet 家族)。短于这个门槛
// 打 cache_control 要么被静默忽略,要么在 Bedrock 上直接报错。粗估 1 token ≈
// 4 char(对英文更准,对 CJK 偏保守 —— CJK 字符密度更高,更容易越过门槛,
// 这里宁可保守一点不打 cache,也别误打无效 cache)。
const PROMPT_CACHE_MIN_CHARS = 1024 * 4;

function estimateTokenFloorMet(text: string): boolean {
  return text.length >= PROMPT_CACHE_MIN_CHARS;
}

function cacheDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDE_DISABLE_CACHE === '1';
}

function bedrockCacheOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAUDE_BEDROCK_CACHE === '1';
}

/**
 * 决定是否真的给一条 system 片段挂 cache_control。
 *
 * 规则:调用方请求 + 没被 `CLAUDE_DISABLE_CACHE=1` 关掉 + 文本长度过门槛 +
 * (direct 默认开,或者 Bedrock 显式 `CLAUDE_BEDROCK_CACHE=1` 开了)。
 *
 * Bedrock 对 prompt cache 的支持和直连 Anthropic SDK 不完全对齐,默认 strip
 * 避免打爆;跑 `scripts/prompt-cache-probe.mjs` 验证过的人可以手动打开。
 */
function shouldApplyCacheControl(
  requested: boolean,
  text: string,
  mode: ClaudeTransportMode,
): boolean {
  if (!requested) return false;
  if (cacheDisabledByEnv()) return false;
  if (mode === 'bedrock' && !bedrockCacheOptIn()) return false;
  return estimateTokenFloorMet(text);
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
    const systemMessages: LlmMessage[] = [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of params.messages) {
      if (m.role === 'system') {
        systemMessages.push(m);
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
      system: buildSystemParam(systemMessages, this.mode),
      messages,
    });

    const textBlocks = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text);
    const content = textBlocks.join('');

    return {
      content,
      usage: translateUsage(response.usage),
    };
  }

  async chatWithTools(params: LlmToolChatParams): Promise<LlmToolChatResponse> {
    const systemMessages: LlmToolMessage[] = [];
    const messages: Anthropic.MessageParam[] = [];
    for (const m of params.messages) {
      if (m.role === 'system') {
        if (typeof m.content !== 'string') {
          throw new Error('chatWithTools(): system messages must have string content.');
        }
        systemMessages.push(m);
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
      system: buildSystemParam(systemMessages, this.mode),
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
      usage: translateUsage(response.usage),
    };
  }
}

/**
 * 把 LlmMessage[] / LlmToolMessage[] 的 system 段翻译成 Anthropic SDK 需要的
 * `system` 参数:可以是 undefined / string / {type,text,cache_control?}[]。
 *
 * 只要任何一段标了 cacheControl 且**实际能打 cache**(见 shouldApplyCacheControl),
 * 整个 system 就走结构化数组路径;否则降级为合并后的单字符串,和改动前语义一致。
 */
function buildSystemParam(
  systemMessages: ReadonlyArray<{ content: string | ReadonlyArray<unknown>; cacheControl?: { type: 'ephemeral' } }>,
  mode: ClaudeTransportMode,
): string | Anthropic.TextBlockParam[] | undefined {
  if (systemMessages.length === 0) return undefined;

  const texts = systemMessages.map((m) => {
    if (typeof m.content !== 'string') {
      throw new Error('system messages must have string content.');
    }
    return { text: m.content, cacheRequested: m.cacheControl?.type === 'ephemeral' };
  });

  const anyCache = texts.some((t) => shouldApplyCacheControl(t.cacheRequested, t.text, mode));
  if (!anyCache) {
    // 全部降级为字符串,和改造前的 systemParts.join 完全一致。
    return texts.map((t) => t.text).join('\n\n');
  }

  return texts.map((t): Anthropic.TextBlockParam => {
    const applies = shouldApplyCacheControl(t.cacheRequested, t.text, mode);
    return applies
      ? { type: 'text', text: t.text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: t.text };
  });
}

function translateUsage(u: Anthropic.Usage): LlmUsage {
  // SDK 0.90.0 上 Usage 有 cache_creation_input_tokens / cache_read_input_tokens,
  // 但类型定义里是 number | null。我们只透传非 null 的值。
  const usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  } = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
  };
  const created = (u as { cache_creation_input_tokens?: number | null }).cache_creation_input_tokens;
  if (typeof created === 'number') usage.cacheCreationInputTokens = created;
  const read = (u as { cache_read_input_tokens?: number | null }).cache_read_input_tokens;
  if (typeof read === 'number') usage.cacheReadInputTokens = read;
  return usage;
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
