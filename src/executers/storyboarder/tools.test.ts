import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { storyboarderTools } from './tools.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';

async function makeCtx(llm: any): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-storyboarder-'));
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
    const chatWithTools = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'emit_storyboarder_output',
          input: storyboardJson,
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
    const ctx = await makeCtx({ chat: vi.fn(), chatWithTools: vi.fn() });
    const res = await storyboarderTools.executors.condense_to_shots!({}, ctx);
    expect(res).toMatchObject({ error: expect.stringMatching(/script/i) });
  });

  it('merges cgList + notes into the persisted storyboard doc', async () => {
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
    const chatWithTools = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'emit_storyboarder_output',
          input: storyboardJson,
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const ctx = await makeCtx({ chat: vi.fn(), chatWithTools });

    await writeWorkspaceDoc('workspace://project', ctx.gameDir, { title: 'T', genre: 'g', tone: 't' });
    await writeWorkspaceDoc('workspace://chapter', ctx.gameDir, { outline: 'C1' });
    await writeWorkspaceDoc('workspace://script', ctx.gameDir, {
      scenes: [{ location: 'classroom', characters: ['Baiying'], lines: [{ speaker: 'Baiying', text: 'hi' }] }],
    });

    const res = await storyboarderTools.executors.condense_to_shots!(
      {
        cgList: [
          { shotNumber: 1, title: 'first meeting', description: 'under the cherry tree', kind: 'scene-establishing' },
          { bogus: true }, // should be filtered out
        ],
        notes: 'Slow pacing in shot 1 sets tone for act 2.',
      },
      ctx,
    );
    expect(res).toMatchObject({ uri: 'workspace://storyboard', shotCount: 1, cgEntries: 1 });

    const doc = JSON.parse(
      await readFile(resolve(ctx.gameDir, '..', 'workspace', 'storyboard.json'), 'utf8'),
    );
    expect(doc.cgList).toEqual([
      { shotNumber: 1, title: 'first meeting', description: 'under the cherry tree', kind: 'scene-establishing' },
    ]);
    expect(doc.notes).toBe('Slow pacing in shot 1 sets tone for act 2.');
  });
});

async function makeCutsceneCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-cutscene-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  const client: RunningHubClient = {
    submitTask: vi.fn().mockResolvedValue({ taskId: 'c1' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/cut.mp4' }),
  };
  const fetchFn: FetchLike = vi.fn(
    async () => new Response(new Uint8Array([4, 5]), { status: 200 }),
  ) as unknown as FetchLike;
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runningHubClient: client,
    fetchFn,
  };
}

describe('storyboarder.generate_cutscene', () => {
  it('errors on invalid kind', async () => {
    const ctx = await makeCutsceneCtx();
    const res = await storyboarderTools.executors.generate_cutscene!(
      { shotNumber: 1, kind: 'bogus', motionPrompt: 'x' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/kind must be/) });
  });

  it('errors when storyboard missing', async () => {
    const ctx = await makeCutsceneCtx();
    const res = await storyboarderTools.executors.generate_cutscene!(
      { shotNumber: 1, kind: 'transition', motionPrompt: 'slow dolly in' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/storyboard not found/) });
  });

  it('produces cutscene doc + registers asset when referenceImageUri is given', async () => {
    const ctx = await makeCutsceneCtx();
    await writeWorkspaceDoc('workspace://storyboard', ctx.gameDir, {
      shots: [
        {
          shotNumber: 1,
          description: 'x',
          characters: [],
          sceneName: 'classroom',
          staging: 'none',
          transforms: 'stand',
          transition: 'cut',
          dialogueLines: [],
        },
      ],
    });
    const res = (await storyboarderTools.executors.generate_cutscene!(
      {
        shotNumber: 1,
        kind: 'transition',
        motionPrompt: 'slow dolly in',
        referenceImageUri: 'https://cdn/first_frame.png',
      },
      ctx,
    )) as { uri: string; videoUri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.uri).toBe('workspace://cutscene/shot_1');
    expect(res.videoUri).toBe('videos/cut/shot_1.mp4');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'cutscenes', 'shot_1.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({
      kind: 'transition',
      videoUri: 'videos/cut/shot_1.mp4',
      referenceImageUri: 'https://cdn/first_frame.png',
    });
  });
});
