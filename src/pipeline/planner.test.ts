import { describe, expect, it, vi } from 'vitest';
import { runPlanner } from './planner.js';
import type {
  LlmChatParams,
  LlmClient,
  LlmResponse,
  LlmToolChatParams,
  LlmToolChatResponse,
} from '../llm/types.js';

const VALID_PLANNER_INPUT = {
  projectTitle: 'Sakura Night',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: 'Hana', description: 'the lead', visualDescription: 'long pink hair, school uniform' },
  ],
  scenes: [{ name: 'garden', description: 'a moonlit sakura garden' }],
  chapterOutline: 'She confesses under the cherry tree.',
};

function toolUseResponse(name: string, input: Record<string, unknown>): LlmToolChatResponse {
  return {
    content: [{ type: 'tool_use', id: 'tu_1', name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe('runPlanner (tool_use)', () => {
  it('calls chatWithTools with exactly one emit_planner_output tool and returns its input', async () => {
    const chatWithTools = vi.fn(async (_p: LlmToolChatParams) =>
      toolUseResponse('emit_planner_output', VALID_PLANNER_INPUT),
    );
    const chat = vi.fn(async (_p: LlmChatParams): Promise<LlmResponse> => {
      throw new Error('chat() should not be called by runPlanner');
    });
    const llm: LlmClient = { chat, chatWithTools };

    const result = await runPlanner({ inspiration: 'a sakura confession', llm });

    expect(result.projectTitle).toBe('Sakura Night');
    expect(result.characters).toHaveLength(1);
    expect(chatWithTools).toHaveBeenCalledTimes(1);
    const call = chatWithTools.mock.calls[0]![0] as LlmToolChatParams;
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0]!.name).toBe('emit_planner_output');
  });

  it('throws when LLM returns no tool_use block', async () => {
    const chatWithTools = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'I refuse' }],
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(runPlanner({ inspiration: 'x', llm })).rejects.toThrow(
      /emit_planner_output/,
    );
  });

  it('throws when tool_use block is missing required fields', async () => {
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_planner_output', { projectTitle: 'x' }),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(runPlanner({ inspiration: 'x', llm })).rejects.toThrow(
      /Planner output/,
    );
  });

  it('passes inspiration as user message', async () => {
    const chatWithTools = vi.fn(async (_p: LlmToolChatParams) =>
      toolUseResponse('emit_planner_output', VALID_PLANNER_INPUT),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await runPlanner({ inspiration: 'MY_UNIQUE_INSPIRATION', llm });

    const call = chatWithTools.mock.calls[0]![0] as LlmToolChatParams;
    const userMessage = call.messages.find((m) => m.role === 'user');
    expect(userMessage).toBeDefined();
    const content = userMessage!.content;
    expect(typeof content === 'string' ? content : JSON.stringify(content)).toContain(
      'MY_UNIQUE_INSPIRATION',
    );
  });
});
