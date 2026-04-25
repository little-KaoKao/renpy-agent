import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateVoiceLine } from './generate-voice-line.js';
import { logicalKeyForVoiceLine } from '../../assets/logical-key.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('logicalKeyForVoiceLine', () => {
  it('embeds scene and line indices', () => {
    expect(logicalKeyForVoiceLine(2, 7)).toBe('voice:scene_2:line_7');
  });
});

describe('generateVoiceLine', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'voice-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits task with voice_text + line_text, downloads output, upserts registry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'v1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/line.mp3',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1, 2]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateVoiceLine({
      sceneNumber: 2,
      lineIndex: 5,
      text: '你又来了。',
      voiceTag: 'soft teenage girl, gentle and slightly melancholic',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.status).toBe('ready');
    expect(result.entry.assetType).toBe('voice_line');
    expect(result.entry.realAssetLocalPath).toBe('audio/voice/scene_2/line_5.mp3');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.logicalKey).toBe('voice:scene_2:line_5');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        appKey: 'VOICE_LINE',
        inputs: expect.arrayContaining([
          expect.objectContaining({ role: 'voice_text', value: expect.stringContaining('soft teenage') }),
          expect.objectContaining({ role: 'line_text', value: '你又来了。' }),
        ]),
      }),
    );
  });

  it('marks error and rethrows when task fails', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'v-bad' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'error',
        errorMessage: 'tts engine overloaded',
      }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateVoiceLine({
        sceneNumber: 1,
        lineIndex: 0,
        text: 'failing line',
        voiceTag: 'whatever',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/tts engine overloaded/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.logicalKey).toBe('voice:scene_1:line_0');
  });
});
