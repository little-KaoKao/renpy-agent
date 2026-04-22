import { describe, expect, it, vi } from 'vitest';
import { ClaudeLlmClient, extractJsonBlock } from './claude-client.js';

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
    const llm = new ClaudeLlmClient({ client: client as any });

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
    const llm = new ClaudeLlmClient({ client: client as any });

    const res = await llm.chat({ messages: [{ role: 'user', content: 'q' }] });

    expect(res.content).toBe('the output');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('throws when no user/assistant messages are provided', async () => {
    const { client } = makeFakeClient('x');
    const llm = new ClaudeLlmClient({ client: client as any });

    await expect(
      llm.chat({ messages: [{ role: 'system', content: 'only-sys' }] }),
    ).rejects.toThrow(/at least one user/);
  });

  it('throws when ANTHROPIC_API_KEY is missing and no client provided', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new ClaudeLlmClient()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
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
