import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSfx } from './generate-sfx.js';
import { logicalKeyForSfx } from '../../assets/logical-key.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('logicalKeyForSfx', () => {
  it('embeds shotNumber and cue', () => {
    expect(logicalKeyForSfx(3, 'enter')).toBe('sfx:shot_3:enter');
    expect(logicalKeyForSfx(12, 'exit')).toBe('sfx:shot_12:exit');
  });
});

describe('generateSfx', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sfx-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits task and lands asset under audio/sfx/shot_<N>_<cue>', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 's1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/door.mp3',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateSfx({
      shotNumber: 7,
      cue: 'enter',
      description: 'a heavy wooden door creaks open slowly',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.assetType).toBe('sfx');
    expect(result.entry.status).toBe('ready');
    expect(result.entry.realAssetLocalPath).toBe('audio/sfx/shot_7_enter.mp3');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.logicalKey).toBe('sfx:shot_7:enter');

    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        appKey: 'SFX',
        inputs: expect.arrayContaining([
          expect.objectContaining({
            role: 'line_text',
            value: expect.stringContaining('wooden door'),
          }),
          expect.objectContaining({
            role: 'voice_text',
            value: expect.stringContaining('ambient sound field'),
          }),
        ]),
      }),
    );
  });

  it('marks error and rethrows when task fails', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 's-bad' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'error',
        errorMessage: 'model unavailable',
      }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateSfx({
        shotNumber: 1,
        cue: 'exit',
        description: 'footsteps fading',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/model unavailable/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.logicalKey).toBe('sfx:shot_1:exit');
  });
});
