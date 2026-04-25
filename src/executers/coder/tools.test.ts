import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { coderTools } from './tools.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';

async function makeCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-coder-'));
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

describe('coder.write_game_project', () => {
  it('writes .rpy files using assembled planner + storyboard from workspace', async () => {
    const ctx = await makeCtx();
    await writeWorkspaceDoc('workspace://project', ctx.gameDir, {
      title: 'TestStory',
      genre: 'g',
      tone: 't',
    });
    await writeWorkspaceDoc('workspace://chapter', ctx.gameDir, { outline: 'C1' });
    await writeWorkspaceDoc('workspace://character/baiying', ctx.gameDir, {
      name: 'Baiying',
      description: 'd',
      visualDescription: 'vd',
    });
    await writeWorkspaceDoc('workspace://scene/classroom', ctx.gameDir, {
      name: 'classroom',
      description: 'empty',
    });
    await writeWorkspaceDoc('workspace://storyboard', ctx.gameDir, {
      shots: [
        {
          shotNumber: 1,
          description: 'meet',
          characters: ['Baiying'],
          sceneName: 'classroom',
          staging: 'mid',
          transforms: 'none',
          transition: 'fade',
          dialogueLines: [{ speaker: 'Baiying', text: 'hi' }],
        },
      ],
    });

    const res = await coderTools.executors.write_game_project!({}, ctx);
    expect(res).toMatchObject({ shotCount: 1 });

    const files = await readdir(ctx.gameDir);
    expect(files).toEqual(expect.arrayContaining(['script.rpy', 'options.rpy', 'gui.rpy', 'screens.rpy']));
  });

  it('errors when storyboard is missing', async () => {
    const ctx = await makeCtx();
    await writeWorkspaceDoc('workspace://project', ctx.gameDir, {
      title: 'T',
      genre: 'g',
      tone: 't',
    });
    await writeWorkspaceDoc('workspace://chapter', ctx.gameDir, { outline: 'C1' });
    const res = await coderTools.executors.write_game_project!({}, ctx);
    expect(res).toMatchObject({ error: expect.stringMatching(/storyboard/i) });
  });
});

describe('coder.swap_asset_placeholder (v0.6 stub)', () => {
  it('returns the deferred-to-v0.7 error', async () => {
    const ctx = await makeCtx();
    const res = await coderTools.executors.swap_asset_placeholder!(
      { logicalKey: 'k', realUri: 'x' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/v0\.6 not yet routed/) });
  });
});
