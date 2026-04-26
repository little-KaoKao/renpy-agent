import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { sfxDesignerTools } from './tools.js';
import type { StoryboarderOutput } from '../../pipeline/types.js';

async function makeCtx(opts: { withStoryboard?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-sfx-'));
  const gameDir = resolve(root, 'game');
  const wsDir = resolve(root, 'workspace');
  await mkdir(gameDir, { recursive: true });
  await mkdir(wsDir, { recursive: true });
  if (opts.withStoryboard) {
    const sb: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 2,
          description: 'door slides open',
          characters: [],
          sceneName: 'classroom',
          staging: 'none',
          transforms: 'stand',
          transition: 'cut',
          dialogueLines: [],
        },
      ],
    };
    await writeFile(resolve(wsDir, 'storyboard.json'), JSON.stringify(sb, null, 2), 'utf8');
  }
  const client: RunningHubClient = {
    submitTask: vi.fn().mockResolvedValue({ taskId: 'sfx1' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/sfx.mp3' }),
  };
  const fetchFn: FetchLike = vi.fn(
    async () => new Response(new Uint8Array([1, 2]), { status: 200 }),
  ) as unknown as FetchLike;
  return {
    storyName: 's',
    gameDir,
    workspaceDir: wsDir,
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runningHubClient: client,
    fetchFn,
  } satisfies CommonToolContext;
}

describe('sfxDesigner.generate_sfx', () => {
  it('errors on invalid cue', async () => {
    const ctx = await makeCtx({ withStoryboard: true });
    const res = await sfxDesignerTools.executors.generate_sfx!(
      { shotNumber: 2, cue: 'rumble', description: 'door slide' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/cue must be one of/) });
  });

  it('errors when shot not in storyboard', async () => {
    const ctx = await makeCtx({ withStoryboard: true });
    const res = await sfxDesignerTools.executors.generate_sfx!(
      { shotNumber: 99, cue: 'enter', description: 'x' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/shot 99/) });
  });

  it('generates sfx and persists workspace://sfx/shot_<N>_<cue>', async () => {
    const ctx = await makeCtx({ withStoryboard: true });
    const res = (await sfxDesignerTools.executors.generate_sfx!(
      { shotNumber: 2, cue: 'enter', description: 'wooden sliding door opens' },
      ctx,
    )) as { uri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.uri).toBe('workspace://sfx/shot_2_enter');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'sfx', 'shot_2_enter.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({ shotNumber: 2, cue: 'enter', status: 'ready' });
  });
});
