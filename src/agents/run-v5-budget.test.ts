import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runV5 } from './run-v5.js';
import {
  call_task_agent,
  type CommonToolContext,
  type TaskAgentRegistry,
} from './common-tools.js';
import type {
  LlmClient,
  LlmToolChatParams,
  LlmToolChatResponse,
} from '../llm/types.js';

/**
 * Scripted LLM that emits a fixed usage per call so we can drive the budget
 * tracker into the cap deterministically. 500k input + 100 output tokens per
 * response ≈ $1.5015 per call at Sonnet 4.6 list pricing.
 */
const EXPENSIVE_USAGE = { inputTokens: 500_000, outputTokens: 100 } as const;

function plannerHandoffStep(pocRole: string, id = 'p1'): LlmToolChatResponse {
  return {
    content: [{ type: 'tool_use', id, name: 'handoff_to_agent', input: { pocRole } }],
    stopReason: 'tool_use',
    usage: EXPENSIVE_USAGE,
  };
}

function plannerFinishStep(
  summary: string,
  id = 'pfin',
): LlmToolChatResponse {
  return {
    content: [
      {
        type: 'tool_use',
        id,
        name: 'output_with_finish',
        input: { taskId: 'done', taskSummary: summary },
      },
    ],
    stopReason: 'tool_use',
    usage: EXPENSIVE_USAGE,
  };
}

function executerStep(name: string, input: Record<string, unknown>, id: string): LlmToolChatResponse {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: EXPENSIVE_USAGE,
  };
}

function scriptedLlm(script: {
  planner: LlmToolChatResponse[];
  executer: LlmToolChatResponse[];
}): LlmClient {
  let pIdx = 0;
  let eIdx = 0;
  return {
    chat: vi.fn(async () => {
      throw new Error('chat() should not be called in this test');
    }),
    chatWithTools: vi.fn(async (params: LlmToolChatParams) => {
      const names = params.tools.map((t) => t.name);
      if (names.includes('handoff_to_agent')) {
        if (pIdx >= script.planner.length) {
          throw new Error(`scripted planner exhausted (idx ${pIdx})`);
        }
        return script.planner[pIdx++]!;
      }
      if (eIdx >= script.executer.length) {
        throw new Error(`scripted executer exhausted (idx ${eIdx})`);
      }
      return script.executer[eIdx++]!;
    }),
  };
}

async function tempGameDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-budget-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return gameDir;
}

describe('runV5 — budget cap', () => {
  it('returns budgetCappedEarly=true and totalCostUsd when cap is hit inside an Executer', async () => {
    // $1.5015 per call. cap=$3 → round 2 cum=$3.003 trips the cap.
    const gameDir = await tempGameDir();
    const llm = scriptedLlm({
      planner: [
        plannerHandoffStep('producer', 'p1'),
        // not reached: Planner won't get another turn after budget exception.
      ],
      executer: [
        // Round 2 (first executer call) — cum hits $3.003 > $3 cap, throws.
        executerStep('create_project', { title: 'X', genre: 'g', tone: 't' }, 'e1'),
      ],
    });

    const result = await runV5({
      storyName: 'budget-cap-mid-exec',
      inspiration: 'test',
      llm,
      gameDir,
      budgetCapUsd: 3,
    });

    expect(result.budgetCappedEarly).toBe(true);
    expect(result.budgetCapUsd).toBe(3);
    expect(result.totalCostUsd).toBeGreaterThan(3);
    expect(result.finalSummary).toMatch(/budget cap/i);
  }, 10000);

  it('budgetCappedEarly=false when cap is never reached', async () => {
    const gameDir = await tempGameDir();
    const llm = scriptedLlm({
      planner: [
        plannerFinishStep('no more tasks, Stage A delivered', 'p1'),
      ],
      executer: [],
    });

    const result = await runV5({
      storyName: 'no-cap-hit',
      inspiration: 'test',
      llm,
      gameDir,
      budgetCapUsd: 100,
    });

    expect(result.budgetCappedEarly).toBe(false);
    expect(result.budgetCapUsd).toBe(100);
    expect(result.totalCostUsd).toBeLessThan(100);
  }, 10000);

  it('reports totalCostUsd even when no budgetCapUsd is set', async () => {
    const gameDir = await tempGameDir();
    const llm = scriptedLlm({
      planner: [
        plannerFinishStep('no more tasks, Stage A delivered', 'p1'),
      ],
      executer: [],
    });

    const result = await runV5({
      storyName: 'no-cap-set',
      inspiration: 'test',
      llm,
      gameDir,
    });

    expect(result.budgetCapUsd).toBeUndefined();
    expect(result.budgetCappedEarly).toBe(false);
    expect(result.totalCostUsd).toBeGreaterThan(0);
  }, 10000);
});

describe('call_task_agent — timeout', () => {
  async function makeCtx(
    taskAgents: TaskAgentRegistry,
    taskAgentTimeoutMs: number | undefined,
  ): Promise<CommonToolContext & { logger: { warn: ReturnType<typeof vi.fn> } }> {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-ta-timeout-'));
    const warn = vi.fn();
    const ctx = {
      storyName: 's',
      gameDir: resolve(root, 'game'),
      workspaceDir: resolve(root, 'workspace'),
      memoryDir: resolve(root, 'memory'),
      taskAgents,
      logger: { info: vi.fn(), warn, error: vi.fn() },
      ...(taskAgentTimeoutMs !== undefined ? { taskAgentTimeoutMs } : {}),
    } satisfies CommonToolContext;
    return ctx as CommonToolContext & { logger: { warn: ReturnType<typeof vi.fn> } };
  }

  it('aborts when a task agent runs longer than taskAgentTimeoutMs', async () => {
    // 50ms timeout, agent that never resolves. Keeps test fast.
    const neverResolves = vi.fn(() => new Promise(() => {}));
    const ctx = await makeCtx(
      { character_main_image_generator: neverResolves as never },
      50,
    );

    const result = await call_task_agent(
      { agentName: 'character_main_image_generator', input: {} },
      ctx,
    );

    expect(result).toMatchObject({
      error: expect.stringMatching(/timeout/i),
      retry: false,
      guidance: expect.stringMatching(/placeholder/i),
    });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'task_agent_timeout',
      expect.objectContaining({
        agentName: 'character_main_image_generator',
        timeoutMs: 50,
      }),
    );
  }, 2000);

  it('does not trip when the agent resolves in time', async () => {
    const fast = vi.fn().mockResolvedValue({ prompt: 'ok' });
    const ctx = await makeCtx({ character_prompt_expander: fast }, 1000);

    const result = await call_task_agent(
      { agentName: 'character_prompt_expander', input: { uri: 'x' } },
      ctx,
    );

    expect(result).toMatchObject({
      agentName: 'character_prompt_expander',
      output: { prompt: 'ok' },
    });
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  }, 2000);

  it('no timeout applied when taskAgentTimeoutMs is undefined', async () => {
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { prompt: 'late' };
    });
    const ctx = await makeCtx({ character_prompt_expander: slow }, undefined);

    const result = await call_task_agent(
      { agentName: 'character_prompt_expander', input: {} },
      ctx,
    );

    expect(result).toMatchObject({
      agentName: 'character_prompt_expander',
      output: { prompt: 'late' },
    });
  }, 2000);
});
