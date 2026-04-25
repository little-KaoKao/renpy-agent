import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { storyboarderTools } from './tools.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';

async function makeCtx(llmChat: any): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-storyboarder-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    llm: { chat: llmChat } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('storyboarder.condense_to_shots', () => {
  it('reads project + chapter + characters + scenes + script, runs storyboarder, persists result', async () => {
    const storyboardJson = {
      shots: [
        {
          shotNumber: 1,
          description: 'meeting',
          characters: ['Baiying'],
          sceneName: 'classroom',
          staging: 'mid',
          transforms: 'none',
          transition: 'fade',
          dialogueLines: [{ speaker: 'Baiying', text: 'hi' }],
        },
      ],
    };
    const chat = vi.fn().mockResolvedValue({
      content: '```json\n' + JSON.stringify(storyboardJson) + '\n```',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const ctx = await makeCtx(chat);

    await writeWorkspaceDoc('workspace://project', ctx.gameDir, {
      title: 'T',
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
    await writeWorkspaceDoc('workspace://script', ctx.gameDir, {
      scenes: [
        {
          location: 'classroom',
          characters: ['Baiying'],
          lines: [{ speaker: 'Baiying', text: 'hi' }],
        },
      ],
    });

    const res = await storyboarderTools.executors.condense_to_shots!({}, ctx);
    expect(res).toMatchObject({ uri: 'workspace://storyboard', shotCount: 1 });
    const doc = JSON.parse(
      await readFile(resolve(ctx.gameDir, '..', 'workspace', 'storyboard.json'), 'utf8'),
    );
    expect(doc.shots).toHaveLength(1);
  });

  it('errors when script is missing', async () => {
    const ctx = await makeCtx(vi.fn());
    const res = await storyboarderTools.executors.condense_to_shots!({}, ctx);
    expect(res).toMatchObject({ error: expect.stringMatching(/script/i) });
  });
});
