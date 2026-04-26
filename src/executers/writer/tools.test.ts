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
});
