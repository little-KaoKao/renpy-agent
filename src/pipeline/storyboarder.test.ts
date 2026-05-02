import { describe, expect, it, vi } from 'vitest';
import { runStoryboarder } from './storyboarder.js';
import type { PlannerOutput, WriterOutput } from './types.js';
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

const WRITER: WriterOutput = {
  scenes: [
    {
      location: 'garden',
      characters: ['Hana'],
      lines: [{ speaker: 'Hana', text: 'hello' }],
    },
  ],
};

const VALID_STORYBOARD_INPUT = {
  shots: [
    {
      shotNumber: 1,
      description: 'open',
      characters: ['Hana'],
      sceneName: 'garden',
      staging: 'solo_center',
      transform: 'stand',
      transition: 'fade',
      effects: [],
      dialogueLines: [{ speaker: 'Hana', text: 'hello' }],
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

describe('runStoryboarder (tool_use)', () => {
  it('calls chatWithTools with emit_storyboarder_output and returns its input', async () => {
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_storyboarder_output', VALID_STORYBOARD_INPUT),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    const result = await runStoryboarder({ planner: PLANNER, writer: WRITER, llm });

    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]!.shotNumber).toBe(1);
    const call = chatWithTools.mock.calls[0]![0] as LlmToolChatParams;
    expect(call.tools.map((t) => t.name)).toEqual(['emit_storyboarder_output']);
  });

  it('throws when shots array is empty', async () => {
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_storyboarder_output', { shots: [] }),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(
      runStoryboarder({ planner: PLANNER, writer: WRITER, llm }),
    ).rejects.toThrow(/Storyboarder output/);
  });

  it('throws when shotNumbers are not contiguous starting at 1', async () => {
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_storyboarder_output', {
        shots: [
          { ...VALID_STORYBOARD_INPUT.shots[0], shotNumber: 5 },
        ],
      }),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(
      runStoryboarder({ planner: PLANNER, writer: WRITER, llm }),
    ).rejects.toThrow(/shotNumber/);
  });

  it('throws when there are more than 8 shots', async () => {
    const bigShots = {
      shots: Array.from({ length: 9 }, (_, i) => ({
        shotNumber: i + 1,
        description: 'x',
        characters: ['Hana'],
        sceneName: 'garden',
        staging: 'solo_center',
        transform: 'stand',
        transition: 'fade',
        effects: [],
        dialogueLines: [{ speaker: 'Hana', text: 'hi' }],
      })),
    };
    const chatWithTools = vi.fn(async () =>
      toolUseResponse('emit_storyboarder_output', bigShots),
    );
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    await expect(
      runStoryboarder({ planner: PLANNER, writer: WRITER, llm }),
    ).rejects.toThrow(/max is 8/);
  });
});
