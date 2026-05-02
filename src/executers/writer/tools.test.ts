import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { writerTools } from './tools.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';

async function makeCtx(llm: any): Promise<CommonToolContext & { llm: any }> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-writer-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    llm,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('writer.draft_script', () => {
  it('assembles PlannerOutput from workspace, calls runWriter via injected llm, and persists WriterOutput', async () => {
    const chatWithTools = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'emit_writer_output',
          input: {
            scenes: [
              {
                location: 'classroom',
                characters: ['Baiying'],
                lines: [{ speaker: 'Baiying', text: 'hi' }],
              },
            ],
          },
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const ctx = await makeCtx({ chat: vi.fn(), chatWithTools });

    await writeWorkspaceDoc('workspace://project', ctx.gameDir, {
      title: 'T',
      genre: 'g',
      tone: 't',
      status: 'ready',
    });
    await writeWorkspaceDoc('workspace://chapter', ctx.gameDir, {
      projectUri: 'workspace://project',
      outline: 'Chapter 1',
      status: 'ready',
    });
    await writeWorkspaceDoc('workspace://character/baiying', ctx.gameDir, {
      name: 'Baiying',
      description: 'd',
      visualDescription: 'vd',
      mainImageUri: null,
      status: 'placeholder',
    });
    await writeWorkspaceDoc('workspace://scene/classroom', ctx.gameDir, {
      name: 'classroom',
      description: 'empty',
      backgroundUri: null,
      status: 'placeholder',
    });

    const res = await writerTools.executors.draft_script!(
      {
        chapterUri: 'workspace://chapter',
        characterUris: ['workspace://character/baiying'],
        sceneUris: ['workspace://scene/classroom'],
      },
      ctx,
    );

    expect(res).toMatchObject({ uri: 'workspace://script' });
    expect(chatWithTools).toHaveBeenCalledTimes(1);

    const doc = JSON.parse(
      await readFile(resolve(ctx.gameDir, '..', 'workspace', 'script.json'), 'utf8'),
    );
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0].lines[0].text).toBe('hi');
  });

  it('errors when chapter is missing', async () => {
    const ctx = await makeCtx({ chat: vi.fn(), chatWithTools: vi.fn() });
    const res = await writerTools.executors.draft_script!(
      { chapterUri: 'workspace://chapter', characterUris: [], sceneUris: [] },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/chapter/i) });
  });

  // Regression guard for M6 smoke (2026-05-02): the LLM emitted empty
  // emit_writer_output on every attempt. The internal retry (2x) exhausted,
  // runWriter threw, and draft_script let the error bubble — so Planner
  // re-handoffed writer indefinitely, burning 36 LLM calls ($2.80). Now
  // draft_script must swallow the error and return retry:false + guidance
  // so the Planner stops hammering writer with the same inputs.
  it('returns non-retriable error with guidance when runWriter exhausts its internal retry', async () => {
    // Simulate what runWriter does on failure: two attempts, both produce
    // empty input that fails assertWriterOutput, retry helper eventually throws.
    const chatWithTools = vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu', name: 'emit_writer_output', input: {} }],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const ctx = await makeCtx({ chat: vi.fn(), chatWithTools });

    await writeWorkspaceDoc('workspace://project', ctx.gameDir, {
      title: 'T', genre: 'g', tone: 't', status: 'ready',
    });
    await writeWorkspaceDoc('workspace://chapter', ctx.gameDir, {
      projectUri: 'workspace://project', outline: 'c1', status: 'ready',
    });

    const res = await writerTools.executors.draft_script!(
      { chapterUri: 'workspace://chapter', characterUris: [], sceneUris: [] },
      ctx,
    );

    expect(res).toMatchObject({
      error: expect.stringMatching(/draft_script failed after internal retry/),
      retry: false,
      guidance: expect.stringMatching(/Do not re-handoff the writer/),
    });
    // Internal retry is bounded at 2 attempts — confirm we didn't explode beyond that.
    expect(chatWithTools.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
