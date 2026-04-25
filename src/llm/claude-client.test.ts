import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeLlmClient,
  CLAUDE_BEDROCK_DEFAULT_MODEL,
  CLAUDE_DIRECT_DEFAULT_MODEL,
  extractJsonBlock,
  resolveClaudeMode,
} from './claude-client.js';

function makeFakeClient(responseText: string) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: responseText }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  return { create, client: { messages: { create } } };
}

describe('ClaudeLlmClient', () => {
  it('passes system messages via system field and user/assistant in messages', async () => {
    const { create, client } = makeFakeClient('hi');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    await llm.chat({
      messages: [
        { role: 'system', content: 'sys-a' },
        { role: 'system', content: 'sys-b' },
        { role: 'user', content: 'hello' },
      ],
    });

    const call = create.mock.calls[0]![0];
    expect(call.system).toBe('sys-a\n\nsys-b');
    expect(call.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('returns concatenated text content and mapped usage', async () => {
    const { client } = makeFakeClient('the output');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    const res = await llm.chat({ messages: [{ role: 'user', content: 'q' }] });

    expect(res.content).toBe('the output');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('throws when no user/assistant messages are provided', async () => {
    const { client } = makeFakeClient('x');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    await expect(
      llm.chat({ messages: [{ role: 'system', content: 'only-sys' }] }),
    ).rejects.toThrow(/at least one user/);
  });

  it('throws when direct mode has no ANTHROPIC_API_KEY', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new ClaudeLlmClient({ mode: 'direct' })).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('throws when bedrock mode has no AWS_REGION', () => {
    const prev = process.env.AWS_REGION;
    delete process.env.AWS_REGION;
    try {
      expect(() => new ClaudeLlmClient({ mode: 'bedrock' })).toThrow(/AWS_REGION/);
    } finally {
      if (prev !== undefined) process.env.AWS_REGION = prev;
    }
  });

  it('throws when bedrock mode has region but no credentials', () => {
    const prevRegion = process.env.AWS_REGION;
    const prevBearer = process.env.AWS_BEARER_TOKEN_BEDROCK;
    const prevAk = process.env.AWS_ACCESS_KEY_ID;
    process.env.AWS_REGION = 'us-east-1';
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.AWS_ACCESS_KEY_ID;
    try {
      expect(() => new ClaudeLlmClient({ mode: 'bedrock' })).toThrow(/Bedrock credentials/);
    } finally {
      if (prevRegion !== undefined) process.env.AWS_REGION = prevRegion;
      else delete process.env.AWS_REGION;
      if (prevBearer !== undefined) process.env.AWS_BEARER_TOKEN_BEDROCK = prevBearer;
      if (prevAk !== undefined) process.env.AWS_ACCESS_KEY_ID = prevAk;
    }
  });

  it('defaults to Bedrock-prefixed model in bedrock mode', () => {
    const { client } = makeFakeClient('x');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'bedrock' });
    expect((llm as any).model).toBe(CLAUDE_BEDROCK_DEFAULT_MODEL);
    expect(llm.mode).toBe('bedrock');
  });

  it('defaults to direct-short model in direct mode', () => {
    const { client } = makeFakeClient('x');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });
    expect((llm as any).model).toBe(CLAUDE_DIRECT_DEFAULT_MODEL);
    expect(llm.mode).toBe('direct');
  });

  it('honors explicit model override', async () => {
    const { create, client } = makeFakeClient('x');
    const llm = new ClaudeLlmClient({
      client: client as any,
      mode: 'direct',
      model: 'claude-opus-4-7',
    });
    await llm.chat({ messages: [{ role: 'user', content: 'q' }] });
    expect(create.mock.calls[0]![0].model).toBe('claude-opus-4-7');
  });
});

describe('ClaudeLlmClient.chatWithTools', () => {
  function makeToolUseClient(
    blocks: ReadonlyArray<Record<string, unknown>>,
    stopReason: string,
  ) {
    const create = vi.fn().mockResolvedValue({
      content: blocks,
      stop_reason: stopReason,
      usage: { input_tokens: 5, output_tokens: 7 },
    });
    return { create, client: { messages: { create } } };
  }

  it('passes tools + user/assistant messages + tool_result content through to SDK', async () => {
    const { create, client } = makeToolUseClient(
      [{ type: 'text', text: 'done' }],
      'end_turn',
    );
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    await llm.chatWithTools({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'echo',
              input: { msg: 'hi' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tu_1',
              content: '{"echoed":"hi"}',
            },
          ],
        },
      ],
      tools: [
        {
          name: 'echo',
          description: 'echoes input',
          inputSchema: {
            type: 'object',
            properties: { msg: { type: 'string' } },
            required: ['msg'],
          },
        },
      ],
    });

    const call = create.mock.calls[0]![0];
    expect(call.system).toBe('sys');
    expect(call.tools).toEqual([
      {
        name: 'echo',
        description: 'echoes input',
        input_schema: {
          type: 'object',
          properties: { msg: { type: 'string' } },
          required: ['msg'],
        },
      },
    ]);
    expect(call.messages).toEqual([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'echo',
            input: { msg: 'hi' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: '{"echoed":"hi"}',
          },
        ],
      },
    ]);
  });

  it('returns tool_use blocks + stopReason=tool_use when SDK stops on tool_use', async () => {
    const { client } = makeToolUseClient(
      [
        { type: 'text', text: 'let me check' },
        {
          type: 'tool_use',
          id: 'tu_42',
          name: 'echo',
          input: { msg: 'hi' },
        },
      ],
      'tool_use',
    );
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    const res = await llm.chatWithTools({
      messages: [{ role: 'user', content: 'please call echo' }],
      tools: [
        {
          name: 'echo',
          description: 'echoes input',
          inputSchema: { type: 'object' },
        },
      ],
    });

    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([
      { type: 'text', text: 'let me check' },
      {
        type: 'tool_use',
        id: 'tu_42',
        name: 'echo',
        input: { msg: 'hi' },
      },
    ]);
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it('returns stopReason=end_turn when SDK stops naturally', async () => {
    const { client } = makeToolUseClient([{ type: 'text', text: 'final' }], 'end_turn');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    const res = await llm.chatWithTools({
      messages: [{ role: 'user', content: 'q' }],
      tools: [],
    });

    expect(res.stopReason).toBe('end_turn');
    expect(res.content).toEqual([{ type: 'text', text: 'final' }]);
  });

  it('throws when no user/assistant messages are provided', async () => {
    const { client } = makeToolUseClient([{ type: 'text', text: 'x' }], 'end_turn');
    const llm = new ClaudeLlmClient({ client: client as any, mode: 'direct' });

    await expect(
      llm.chatWithTools({
        messages: [{ role: 'system', content: 'only-sys' }],
        tools: [],
      }),
    ).rejects.toThrow(/at least one user/);
  });
});

describe('resolveClaudeMode', () => {
  it('returns bedrock when CLAUDE_CODE_USE_BEDROCK=1', () => {
    expect(resolveClaudeMode({ CLAUDE_CODE_USE_BEDROCK: '1' } as any)).toBe('bedrock');
  });

  it('returns direct when CLAUDE_CODE_USE_BEDROCK unset', () => {
    expect(resolveClaudeMode({} as any)).toBe('direct');
  });

  it('returns direct when CLAUDE_CODE_USE_BEDROCK=0', () => {
    expect(resolveClaudeMode({ CLAUDE_CODE_USE_BEDROCK: '0' } as any)).toBe('direct');
  });
});

describe('extractJsonBlock', () => {
  it('extracts from ```json fence', () => {
    const raw = 'blah\n```json\n{"a":1}\n```\nafter';
    expect(extractJsonBlock(raw)).toBe('{"a":1}');
  });

  it('extracts from unlabeled fence', () => {
    const raw = '```\n[1,2]\n```';
    expect(extractJsonBlock(raw)).toBe('[1,2]');
  });

  it('returns bare JSON when not fenced', () => {
    expect(extractJsonBlock('  {"ok":true}  ')).toBe('{"ok":true}');
  });

  it('throws when no JSON is present', () => {
    expect(() => extractJsonBlock('just prose')).toThrow(/JSON block/);
  });
});
