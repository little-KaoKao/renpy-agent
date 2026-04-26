import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { voiceDirectorTools } from './tools.js';
import type { StoryboarderOutput } from '../../pipeline/types.js';

async function makeCtx(opts: { withClient?: boolean; withStoryboard?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-voice-'));
  const gameDir = resolve(root, 'game');
  const wsDir = resolve(root, 'workspace');
  await mkdir(gameDir, { recursive: true });
  await mkdir(wsDir, { recursive: true });
  if (opts.withStoryboard) {
    const sb: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 1,
          description: 'classroom dusk',
          characters: ['Baiying'],
          sceneName: 'classroom',
          staging: 'solo_center',
          transforms: 'stand',
          transition: 'dissolve',
          dialogueLines: [{ speaker: 'Baiying', text: '你好呀' }],
        },
      ],
    };
    await writeFile(resolve(wsDir, 'storyboard.json'), JSON.stringify(sb, null, 2), 'utf8');
  }
  const base: CommonToolContext = {
    storyName: 's',
    gameDir,
    workspaceDir: wsDir,
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  if (!opts.withClient) return base;
  const client: RunningHubClient = {
    submitTask: vi.fn().mockResolvedValue({ taskId: 'v1' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/voice.mp3' }),
  };
  const fetchFn: FetchLike = vi.fn(
    async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  ) as unknown as FetchLike;
  return { ...base, runningHubClient: client, fetchFn };
}

describe('voiceDirector.generate_voice_line', () => {
  it('errors when shot missing in storyboard', async () => {
    const ctx = await makeCtx({ withClient: true, withStoryboard: true });
    const res = await voiceDirectorTools.executors.generate_voice_line!(
      { shotNumber: 99, lineIndex: 0 },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/shot 99 not found/) });
  });

  it('errors when storyboard not found', async () => {
    const ctx = await makeCtx({ withClient: true });
    const res = await voiceDirectorTools.executors.generate_voice_line!(
      { shotNumber: 1, lineIndex: 0 },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/storyboard not found/) });
  });

  it('generates voice line using storyboard text and persists VoiceLine doc', async () => {
    const ctx = await makeCtx({ withClient: true, withStoryboard: true });
    const res = (await voiceDirectorTools.executors.generate_voice_line!(
      { shotNumber: 1, lineIndex: 0 },
      ctx,
    )) as { uri: string; audioUri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.uri).toBe('workspace://voiceLine/shot_1_line_0');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'voice_lines', 'shot_1_line_0.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({
      shotNumber: 1,
      lineIndex: 0,
      speaker: 'Baiying',
      text: '你好呀',
      status: 'ready',
    });
  });
});
