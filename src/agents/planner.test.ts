import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runPlannerTask } from './planner.js';
import type { CommonToolContext } from './common-tools.js';
import type { LlmClient, LlmToolChatResponse } from '../llm/types.js';

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

async function makeCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-planner-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('runPlannerTask', () => {
  it('returns {done: true} when Planner finishes with "no more tasks" summary', async () => {
    const ctx = await makeCtx();
    const llm = scriptedLlm([
      {
        content: [
          {
            type: 'tool_use',
            id: 'p1',
            name: 'output_with_finish',
            input: { taskId: 'done', taskSummary: 'no more tasks' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    const result = await runPlannerTask({
      storyName: 's',
      llm,
      ctx,
      executerLlm: llm,
      maxTurns: 10,
    });

    expect(result.done).toBe(true);
    expect(result.taskSummary).toContain('no more tasks');
  });

  it('dispatches handoff_to_agent to sub-conversation and puts its summary in the tool_result', async () => {
    const ctx = await makeCtx();

    // Planner: 2 turns. Turn 1 -> handoff_to_agent(producer). Turn 2 -> finish.
    const plannerResponses: LlmToolChatResponse[] = [
      {
        content: [
          {
            type: 'tool_use',
            id: 'p1',
            name: 'handoff_to_agent',
            input: { pocRole: 'producer' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        content: [
          {
            type: 'tool_use',
            id: 'p2',
            name: 'output_with_finish',
            input: { taskId: 'done', taskSummary: 'all tasks complete' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ];

    // Executer: 2 turns. Turn 1 -> create_project. Turn 2 -> finish.
    const executerResponses: LlmToolChatResponse[] = [
      {
        content: [
          {
            type: 'tool_use',
            id: 'e1',
            name: 'create_project',
            input: { title: 'T', genre: 'g', tone: 't' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      {
        content: [
          {
            type: 'tool_use',
            id: 'e2',
            name: 'output_with_finish',
            input: { taskId: 'p', taskSummary: 'created project T' },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ];

    let plannerIdx = 0;
    let executerIdx = 0;
    const chatWithTools = vi.fn(async (params: any) => {
      // Distinguish by schema set — planner has handoff_to_agent, executer has producer tools
      const names = params.tools.map((t: any) => t.name);
      if (names.includes('handoff_to_agent')) {
        return plannerResponses[plannerIdx++]!;
      }
      return executerResponses[executerIdx++]!;
    });
    const llm: LlmClient = { chat: vi.fn(), chatWithTools };

    const result = await runPlannerTask({
      storyName: 's',
      llm,
      ctx,
      executerLlm: llm,
      maxTurns: 10,
    });

    expect(result.done).toBe(true);
    // Find the Planner's turn-2 call (the one whose tools include handoff_to_agent and
    // whose message list contains tool_result blocks — i.e., not the first call).
    const plannerCalls = (chatWithTools as any).mock.calls.filter((c: any[]) =>
      c[0].tools.some((t: any) => t.name === 'handoff_to_agent'),
    );
    expect(plannerCalls).toHaveLength(2);
    const planner2ndCall = plannerCalls[1][0];
    const toolResults = planner2ndCall.messages
      .filter((m: any) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m: any) => m.content)
      .filter((b: any) => b.type === 'tool_result');
    expect(toolResults.length).toBeGreaterThan(0);
    expect(JSON.stringify(toolResults[0].content)).toContain('created project T');
  });
});
