import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runExecuterTask } from './executer.js';
import type { CommonToolContext } from './common-tools.js';
import type { LlmClient, LlmToolChatResponse } from '../llm/types.js';

// Scripted LLM that returns a pre-recorded sequence of tool-chat responses.
function scriptedLlm(responses: LlmToolChatResponse[]): LlmClient {
  let i = 0;
  return {
    chat: vi.fn(),
    chatWithTools: vi.fn(async () => {
      if (i >= responses.length) throw new Error('scripted LLM exhausted');
      return responses[i++]!;
    }),
  };
}

async function makeCtx(overrides: Partial<CommonToolContext> = {}): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-executer-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('runExecuterTask', () => {
  it('dispatches POC tool_use blocks and loops until output_with_finish', async () => {
    const ctx = await makeCtx();
    const llm = scriptedLlm([
      // Turn 1: executer calls create_project
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'create_project',
            input: { title: 'T', genre: 'g', tone: 't' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // Turn 2: executer signals task done
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'output_with_finish',
            input: {
              taskId: 'create-proj',
              taskSummary: 'created project T',
            },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    const result = await runExecuterTask({
      pocRole: 'producer',
      userBrief: 'create project T with romance/bittersweet',
      llm,
      ctx,
      maxTurns: 10,
    });

    expect(result.taskSummary).toBe('created project T');
    expect(llm.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it('returns tool_result errors to the LLM so it can recover', async () => {
    const ctx = await makeCtx();
    const llm = scriptedLlm([
      // Turn 1: invalid tool call (missing required fields)
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'create_project',
            input: { title: '' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // Turn 2: corrected call
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'create_project',
            input: { title: 'T', genre: 'g', tone: 't' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      // Turn 3: finish
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_3',
            name: 'output_with_finish',
            input: { taskId: 'p', taskSummary: 'done' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    const result = await runExecuterTask({
      pocRole: 'producer',
      userBrief: 'create project T',
      llm,
      ctx,
      maxTurns: 10,
    });

    expect(result.taskSummary).toBe('done');
    // 3rd call should contain the "error" tool_result from turn 1.
    const thirdCallArgs = (llm.chatWithTools as any).mock.calls[2][0];
    const toolResults = thirdCallArgs.messages
      .filter((m: any) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m: any) => m.content)
      .filter((b: any) => b.type === 'tool_result');
    const firstResultText = JSON.stringify(toolResults[0].content);
    expect(firstResultText).toMatch(/error/i);
  });

  it('errors out after maxTurns without a finish', async () => {
    const ctx = await makeCtx();
    const llm = scriptedLlm(
      Array.from({ length: 10 }, (_, n) => ({
        content: [
          {
            type: 'tool_use' as const,
            id: `tu_${n}`,
            name: 'create_project',
            input: { title: 'T', genre: 'g', tone: 't' },
          },
        ],
        stopReason: 'tool_use' as const,
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    );

    await expect(
      runExecuterTask({
        pocRole: 'producer',
        userBrief: 'spin forever',
        llm,
        ctx,
        maxTurns: 3,
      }),
    ).rejects.toThrow(/maxTurns/);
  });
});
