import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateBgmTrack,
  logicalKeyForBgm,
} from './generate-bgm-track.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('logicalKeyForBgm', () => {
  it('slugifies the track name', () => {
    expect(logicalKeyForBgm('Sakura Night Theme')).toBe('bgm:sakura_night_theme');
  });
});

describe('generateBgmTrack', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bgm-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits task, downloads output, and upserts registry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'b1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/track.mp3',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateBgmTrack({
      trackName: 'Sakura Night Theme',
      styleDescription: 'soft piano, bittersweet romantic ambient',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.status).toBe('ready');
    expect(result.entry.assetType).toBe('bgm_track');
    expect(result.entry.realAssetLocalPath).toBe('audio/bgm/sakura_night_theme.mp3');
    expect(result.remoteUrl).toBe('https://cdn/track.mp3');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.logicalKey).toBe('bgm:sakura_night_theme');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        appKey: 'BGM_TRACK',
        inputs: expect.arrayContaining([
          expect.objectContaining({ role: 'title', value: 'Sakura Night Theme' }),
          expect.objectContaining({
            role: 'prompt',
            value: expect.stringContaining('soft piano'),
          }),
        ]),
      }),
    );
  });

  it('marks error and rethrows when submit fails', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockRejectedValue(new Error('suno submit blocked')),
      pollTask: vi.fn(),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateBgmTrack({
        trackName: 'Broken Track',
        styleDescription: 'whatever',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/suno submit blocked/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.assetType).toBe('bgm_track');
    expect(reloaded.entries[0]!.errorMessage).toMatch(/suno submit blocked/);
  });

  it('marks error when poll reports failed task', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'b-fail' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'error',
        errorMessage: 'suno upstream busy',
      }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateBgmTrack({
        trackName: 'Upstream Busy',
        styleDescription: 'whatever',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/suno upstream busy/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.errorMessage).toMatch(/suno upstream busy/);
  });
});
