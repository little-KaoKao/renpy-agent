import { describe, expect, it, vi } from 'vitest';
import { runWriter } from './writer.js';
import type { PlannerOutput } from './types.js';
import type {
  LlmClient,
  LlmToolChatParams,
  LlmToolChatResponse,
} from '../llm/types.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'Sakura Night',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: 'Hana', description: 'the lead', visualDescription: 'long pink hair' },
  ],
  scenes: [{ name: 'garden', description: 'sakura garden' }],
  chapterOutline: 'She confesses under the cherry tree.',
};

const VALID_WRITER_INPUT = {
  scenes: [
    {
      location: 'garden',
      characters: ['Hana'],
      lines: [
        { speaker: 'Hana', text: '你愿意听我说完吗?' },
        { speaker: 'narrator', text: '她看着樱花。' },
      ],
    },
  ],
};

function toolUseResponse(name: string, input: Record<string, unknown>): LlmToolChatResponse {
  return {
    content: [{ type: 'tool_use', id: 'tu_1', name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe('runWriter (tool_use)', () => {
  it('calls chatWithTools with emit_writer_output and returns its input', async () => {
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_writer_output', VALID_WRITER_INPUT),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    const result = await runWriter({ planner: PLANNER, llm });

    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.location).toBe('garden');
    expect(chatWithTools).toHaveBeenCalledTimes(1);
    const call = chatWithTools.mock.calls[0]![0] as LlmToolChatParams;
    expect(call.tools.map((t) => t.name)).toEqual(['emit_writer_output']);
  });

  it('throws when emit_writer_output tool_use is missing', async () => {
    const chatWithTools = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'sorry' }],
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(runWriter({ planner: PLANNER, llm })).rejects.toThrow(
      /emit_writer_output/,
    );
  });

  it('throws when scenes is empty', async () => {
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_writer_output', { scenes: [] }),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(runWriter({ planner: PLANNER, llm })).rejects.toThrow(
      /Writer output/,
    );
  });

  it('round-trips CJK inner quotes without needing repair', async () => {
    // tool_use inputs arrive as structured JSON objects, not string-encoded JSON.
    // CJK inner quotes are therefore impossible to mis-encode: the SDK hands us the
    // object directly. Confirm runWriter is a pure pass-through for such text.
    const withInnerQuotes = {
      scenes: [
        {
          location: 'garden',
          characters: ['Hana'],
          lines: [
            { speaker: 'Hana', text: '他说"别走"。然后转身离开。' },
          ],
        },
      ],
    };
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_writer_output', withInnerQuotes),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    const result = await runWriter({ planner: PLANNER, llm });

    expect(result.scenes[0]!.lines[0]!.text).toBe('他说"别走"。然后转身离开。');
  });
});
