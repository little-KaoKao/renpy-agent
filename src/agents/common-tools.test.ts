import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext, TaskAgentRegistry } from './common-tools.js';
import {
  output_with_plan,
  output_with_finish,
  read_from_uri,
  handoff_to_agent,
  call_task_agent,
  active_workflow,
  check_workflow_params,
  get_workflow_guide,
} from './common-tools.js';
import { loadPlannerMemories } from './memory.js';

async function makeCtx(
  overrides: Partial<CommonToolContext> = {},
  taskAgents: TaskAgentRegistry = {},
): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-common-'));
  const gameDir = resolve(root, 'game');
  const workspaceDir = resolve(root, 'workspace');
  const memoryDir = resolve(root, 'memory');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 'test-story',
    gameDir,
    workspaceDir,
    memoryDir,
    taskAgents,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

describe('output_with_plan', () => {
  it('appends a plan entry to the memory log and returns ok', async () => {
    const ctx = await makeCtx();
    const result = await output_with_plan(
      { taskId: 't1', plan: 'pseudo-code here' },
      ctx,
    );
    expect(result).toEqual({ ok: true });

    const entries = await loadPlannerMemories(ctx.memoryDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId: 't1',
      kind: 'plan',
      summary: 'pseudo-code here',
    });
  });

  it('warns when a new taskId is started before the previous plan is finished', async () => {
    const ctx = await makeCtx();
    await output_with_plan({ taskId: 't1', plan: 'first' }, ctx);
    await output_with_plan({ taskId: 't2', plan: 'second' }, ctx);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'output_with_plan.orphan_previous',
      { previousTaskId: 't1', currentTaskId: 't2' },
    );
  });

  it('does not warn when repeating the same taskId (revising the plan)', async () => {
    const ctx = await makeCtx();
    await output_with_plan({ taskId: 't1', plan: 'first' }, ctx);
    await output_with_plan({ taskId: 't1', plan: 'revised' }, ctx);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('does not warn when the previous plan has a matching finish', async () => {
    const ctx = await makeCtx();
    await output_with_plan({ taskId: 't1', plan: 'first' }, ctx);
    await output_with_finish({ taskId: 't1', taskSummary: 'done' }, ctx);
    await output_with_plan({ taskId: 't2', plan: 'next task' }, ctx);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });
});

describe('output_with_finish', () => {
  it('appends a finish entry and returns ok', async () => {
    const ctx = await makeCtx();
    const result = await output_with_finish(
      { taskId: 't2', taskSummary: 'completed step X' },
      ctx,
    );
    expect(result).toEqual({ ok: true });

    const entries = await loadPlannerMemories(ctx.memoryDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId: 't2',
      kind: 'finish',
      summary: 'completed step X',
    });
  });
});

describe('read_from_uri', () => {
  it('returns JSON content when file exists', async () => {
    const ctx = await makeCtx();
    const wsDir = resolve(ctx.gameDir, '..', 'workspace');
    await mkdir(resolve(wsDir, 'characters'), { recursive: true });
    const payload = { name: 'Baiying', visualDescription: 'long hair' };
    await writeFile(
      resolve(wsDir, 'characters', 'baiying.json'),
      JSON.stringify(payload),
    );

    const result = await read_from_uri({ uri: 'workspace://character/baiying' }, ctx);
    expect(result).toEqual({ kind: 'character', content: payload });
  });

  it('returns error when file does not exist', async () => {
    const ctx = await makeCtx();
    const result = await read_from_uri({ uri: 'workspace://character/missing' }, ctx);
    expect(result).toMatchObject({ error: expect.stringMatching(/not found/i) });
  });

  it('returns error when URI is invalid', async () => {
    const ctx = await makeCtx();
    const result = await read_from_uri({ uri: 'http://nope' }, ctx);
    expect(result).toMatchObject({ error: expect.stringMatching(/workspace:\/\//) });
  });
});

describe('handoff_to_agent', () => {
  it('returns role descriptor + tool names for a known role', async () => {
    const ctx = await makeCtx();
    const result = await handoff_to_agent({ pocRole: 'producer' }, ctx);
    expect(result).toMatchObject({
      pocRole: 'producer',
      toolNames: expect.arrayContaining(['create_project', 'create_chapter']),
    });
  });

  it('returns error when role is unknown', async () => {
    const ctx = await makeCtx();
    const result = await handoff_to_agent(
      { pocRole: 'mystery' as any },
      ctx,
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/unknown POC role/) });
  });
});

describe('call_task_agent', () => {
  it('dispatches to a registered task agent and returns its output', async () => {
    const expander = vi.fn().mockResolvedValue({ prompt: 'expanded' });
    const ctx = await makeCtx({}, { character_prompt_expander: expander });

    const result = await call_task_agent(
      { agentName: 'character_prompt_expander', input: { characterUri: 'workspace://character/x' } },
      ctx,
    );

    expect(expander).toHaveBeenCalledWith(
      { characterUri: 'workspace://character/x' },
      expect.objectContaining({ storyName: 'test-story' }),
    );
    expect(result).toEqual({
      agentName: 'character_prompt_expander',
      output: { prompt: 'expanded' },
    });
  });

  it('returns error for unknown agent names with retry=false + guidance', async () => {
    const ctx = await makeCtx();
    const result = await call_task_agent(
      { agentName: 'unknown_agent', input: {} },
      ctx,
    );
    expect(result).toMatchObject({
      error: expect.stringMatching(/not implemented/),
      retry: false,
      guidance: expect.stringMatching(/placeholder/i),
    });
  });

  it('surfaces task-agent errors as tool_result with retry=true + guidance', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    const ctx = await makeCtx({}, { character_prompt_expander: bad });
    const result = await call_task_agent(
      { agentName: 'character_prompt_expander', input: {} },
      ctx,
    );
    expect(result).toMatchObject({
      error: expect.stringMatching(/boom/),
      retry: true,
      guidance: expect.stringMatching(/retry/i),
    });
  });
});

describe('workflow stubs (v0.6 unavailable)', () => {
  const expected = {
    error: expect.stringMatching(/v0\.6 unavailable/),
    retry: false,
    guidance: expect.stringMatching(/workflow/i),
  };
  it('active_workflow returns error with retry=false + guidance', async () => {
    const ctx = await makeCtx();
    expect(await active_workflow({ workflowName: 'whatever' }, ctx)).toMatchObject(expected);
  });
  it('check_workflow_params returns error with retry=false + guidance', async () => {
    const ctx = await makeCtx();
    expect(await check_workflow_params({ workflowName: 'whatever' }, ctx)).toMatchObject(expected);
  });
  it('get_workflow_guide returns error with retry=false + guidance', async () => {
    const ctx = await makeCtx();
    expect(await get_workflow_guide({ workflowName: 'whatever' }, ctx)).toMatchObject(expected);
  });
});
