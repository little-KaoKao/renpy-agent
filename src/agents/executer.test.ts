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
    // Use the exempt tool read_from_uri so the soft limit doesn't short-circuit
    // before we hit maxTurns.
    const llm = scriptedLlm(
      Array.from({ length: 10 }, (_, n) => ({
        content: [
          {
            type: 'tool_use' as const,
            id: `tu_${n}`,
            name: 'read_from_uri',
            input: { uri: 'workspace://project' },
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

  it('refuses a 3rd invocation of the same non-exempt tool and lets LLM finish', async () => {
    const ctx = await makeCtx();
    const warnSpy = ctx.logger.warn as ReturnType<typeof vi.fn>;
    const responses: LlmToolChatResponse[] = [1, 2, 3].map((n) => ({
      content: [
        {
          type: 'tool_use' as const,
          id: `tu_p${n}`,
          name: 'create_project',
          input: { title: `T${n}`, genre: 'g', tone: 't' },
        },
      ],
      stopReason: 'tool_use' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    responses.push({
      content: [
        {
          type: 'tool_use',
          id: 'tu_f',
          name: 'output_with_finish',
          input: { taskId: 'p', taskSummary: 'partial' },
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const llm = scriptedLlm(responses);

    const result = await runExecuterTask({
      pocRole: 'producer',
      userBrief: 'spam create_project',
      llm,
      ctx,
      maxTurns: 10,
    });

    expect(result.taskSummary).toBe('partial');

    const fourthCallArgs = (llm.chatWithTools as any).mock.calls[3][0];
    const toolResults = fourthCallArgs.messages
      .filter((m: any) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m: any) => m.content)
      .filter((b: any) => b.type === 'tool_result');
    const refusal = toolResults.find((r: any) => r.toolUseId === 'tu_p3');
    expect(refusal).toBeDefined();
    expect(refusal.isError).toBe(true);
    const parsed = JSON.parse(refusal.content);
    expect(parsed.retry).toBe(false);
    expect(parsed.error).toMatch(/refusing to execute/);
    expect(parsed.guidance).toMatch(/output_with_finish/);

    const softLimitHits = warnSpy.mock.calls.filter(
      (c) => c[0] === 'executer.soft_limit_hit',
    );
    expect(softLimitHits).toHaveLength(1);
    expect(softLimitHits[0]![1]).toMatchObject({ tool: 'create_project', count: 3 });
  });

  it('exempts read_from_uri from the per-tool soft limit', async () => {
    const ctx = await makeCtx();
    const warnSpy = ctx.logger.warn as ReturnType<typeof vi.fn>;
    const responses: LlmToolChatResponse[] = [1, 2, 3, 4, 5].map((n) => ({
      content: [
        {
          type: 'tool_use' as const,
          id: `tu_r${n}`,
          name: 'read_from_uri',
          input: { uri: 'workspace://project' },
        },
      ],
      stopReason: 'tool_use' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    responses.push({
      content: [
        {
          type: 'tool_use',
          id: 'tu_rf',
          name: 'output_with_finish',
          input: { taskId: 'r', taskSummary: 'read pass' },
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const llm = scriptedLlm(responses);

    const result = await runExecuterTask({
      pocRole: 'producer',
      userBrief: 'read repeatedly',
      llm,
      ctx,
      maxTurns: 20,
    });

    expect(result.taskSummary).toBe('read pass');
    const softLimitHits = warnSpy.mock.calls.filter(
      (c) => c[0] === 'executer.soft_limit_hit',
    );
    expect(softLimitHits).toHaveLength(0);
  });
});
