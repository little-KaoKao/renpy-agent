import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runV5 } from './run-v5.js';
import { call_task_agent } from './common-tools.js';
import type { LlmClient, LlmToolChatParams, LlmToolChatResponse } from '../llm/types.js';

/**
 * Verifies the v0.7 task-agent bootstrap in run-v5:
 *  - When no RUNNINGHUB_API_KEY is set (and no runningHubClient injected), the
 *    Planner loop must still have the 3 task agents available, but each one
 *    must short-circuit through the DRY_RUN branch (mock URI + mock localPath).
 *  - The logger must emit a `task_agents.dry_run_fallback` warn so operators
 *    don't confuse a DRY_RUN smoke run for a real one.
 */
describe('runV5 task-agent bootstrap (§5.4)', () => {
  const originalEnv = process.env.RUNNINGHUB_API_KEY;

  beforeEach(() => {
    delete process.env.RUNNINGHUB_API_KEY;
  });
  afterEach(() => {
    if (originalEnv !== undefined) process.env.RUNNINGHUB_API_KEY = originalEnv;
    else delete process.env.RUNNINGHUB_API_KEY;
  });

  it('falls back to DRY_RUN task-agents when no RUNNINGHUB_API_KEY + no client', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-ta-dryrun-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });

    // Seed a character doc so character_prompt_expander has material to chew on
    // when the Planner hands off.
    const charsDir = resolve(gameDir, '..', 'workspace', 'characters');
    await mkdir(charsDir, { recursive: true });
    await writeFile(
      resolve(charsDir, 'mai.json'),
      JSON.stringify({ name: 'Mai', visualDescription: 'long black hair' }),
    );

    // Planner ends immediately — we only care that runV5's bootstrap wired the
    // agents before any loop turn.
    const llm: LlmClient = {
      chat: vi.fn(async () => {
        throw new Error('unused');
      }),
      chatWithTools: vi.fn(
        async (_params: LlmToolChatParams): Promise<LlmToolChatResponse> => ({
          content: [
            {
              type: 'tool_use',
              id: 'fin',
              name: 'output_with_finish',
              input: { taskId: 'x', taskSummary: 'nothing to do' },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ),
    };

    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() };

    const result = await runV5({
      storyName: 'dry-run-smoke',
      inspiration: 'test',
      llm,
      gameDir,
      logger,
      maxPlannerTasks: 1,
    });

    expect(result.finalSummary).toMatch(/nothing to do/);
    expect(warn).toHaveBeenCalledWith(
      'task_agents.dry_run_fallback',
      expect.objectContaining({ reason: expect.stringMatching(/RUNNINGHUB_API_KEY|runningHubClient/) }),
    );
  });

  it('injected runningHubClient + env key → real task-agents (no DRY_RUN warn)', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-ta-real-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });

    process.env.RUNNINGHUB_API_KEY = 'test-key';
    const llm: LlmClient = {
      chat: vi.fn(async () => {
        throw new Error('unused');
      }),
      chatWithTools: vi.fn(
        async (): Promise<LlmToolChatResponse> => ({
          content: [
            {
              type: 'tool_use',
              id: 'fin',
              name: 'output_with_finish',
              input: { taskId: 'x', taskSummary: 'ok' },
            },
          ],
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      ),
    };
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() };
    const runningHubClient = { submitTask: vi.fn(), pollTask: vi.fn() };

    await runV5({
      storyName: 'real-smoke',
      inspiration: 'test',
      llm,
      gameDir,
      logger,
      maxPlannerTasks: 1,
      runningHubClient,
    });

    expect(warn).not.toHaveBeenCalledWith(
      'task_agents.dry_run_fallback',
      expect.anything(),
    );
  });

  it('DRY_RUN registry produces dry_run status via call_task_agent', async () => {
    // This exercises the Executer-side plumbing: the registry injected by
    // runV5's fallback must honour the DRY_RUN sentinel so call_task_agent
    // returns a non-error output. We build a ctx manually to avoid standing
    // up the full Planner loop — the bootstrap logic lives in run-v5, but the
    // contract is "registry values produce dry_run when called".
    const root = await mkdtemp(resolve(tmpdir(), 'v5-ta-call-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });
    const charsDir = resolve(gameDir, '..', 'workspace', 'characters');
    await mkdir(charsDir, { recursive: true });
    await writeFile(
      resolve(charsDir, 'rei.json'),
      JSON.stringify({ name: 'Rei', visualDescription: 'violet hair' }),
    );

    const { buildDefaultTaskAgents } = await import(
      '../executers/task-agents/index.js'
    );
    const taskAgents = buildDefaultTaskAgents(true);
    const ctx = {
      storyName: 's',
      gameDir,
      workspaceDir: resolve(root, 'workspace'),
      memoryDir: resolve(root, 'memory'),
      taskAgents,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await call_task_agent(
      {
        agentName: 'character_main_image_generator',
        input: { characterUri: 'workspace://character/rei' },
      },
      ctx,
    );
    expect(result).toMatchObject({
      agentName: 'character_main_image_generator',
      output: expect.objectContaining({
        status: 'dry_run',
        dryRun: true,
      }),
    });
  });
});
