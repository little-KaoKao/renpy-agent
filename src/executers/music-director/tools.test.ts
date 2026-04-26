import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { musicDirectorTools } from './tools.js';

async function makeCtx(options: {
  readonly withClient?: boolean;
  readonly clientOverrides?: Partial<RunningHubClient>;
} = {}): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-music-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  const base: CommonToolContext = {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  if (!options.withClient) return base;
  const client: RunningHubClient = {
    submitTask: vi.fn().mockResolvedValue({ taskId: 'b1' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/track.mp3' }),
    ...options.clientOverrides,
  };
  const fetchFn: FetchLike = vi.fn(
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  ) as unknown as FetchLike;
  return { ...base, runningHubClient: client, fetchFn };
}

describe('musicDirector.generate_bgm_track', () => {
  it('errors when runningHubClient is not injected', async () => {
    const ctx = await makeCtx();
    const res = await musicDirectorTools.executors.generate_bgm_track!(
      { trackName: 'Theme', styleDescription: 'piano, soft' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/runningHubClient/) });
  });

  it('errors when styleDescription missing', async () => {
    const ctx = await makeCtx({ withClient: true });
    const res = await musicDirectorTools.executors.generate_bgm_track!(
      { trackName: 'Theme' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/styleDescription/) });
  });

  it('generates track, writes BgmTrack doc, and registers asset', async () => {
    const ctx = await makeCtx({ withClient: true });
    const res = (await musicDirectorTools.executors.generate_bgm_track!(
      {
        trackName: 'Sakura Night Theme',
        moodTag: 'calm',
        styleDescription: 'soft piano, bittersweet romantic ambient',
      },
      ctx,
    )) as { uri: string; audioUri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.uri).toBe('workspace://bgmTrack/sakura_night_theme');
    expect(res.audioUri).toBe('audio/bgm/sakura_night_theme.mp3');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'bgm_tracks', 'sakura_night_theme.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({
      trackName: 'Sakura Night Theme',
      moodTag: 'calm',
      audioUri: 'audio/bgm/sakura_night_theme.mp3',
      status: 'ready',
    });
  });

  it('returns tool error (does not throw) when generate fails', async () => {
    const ctx = await makeCtx({
      withClient: true,
      clientOverrides: {
        submitTask: vi.fn().mockRejectedValue(new Error('suno submit blocked')),
      },
    });
    const res = await musicDirectorTools.executors.generate_bgm_track!(
      {
        trackName: 'Broken',
        styleDescription: 'x',
      },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/suno submit blocked/) });
  });
});
