import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSceneTimeVariantPrompt,
  generateSceneTimeVariant,
} from './generate-time-variant.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('buildSceneTimeVariantPrompt', () => {
  it('folds timeOfDay and lighting into the prompt', () => {
    const out = buildSceneTimeVariantPrompt(
      'empty classroom',
      'dusk',
      'warm orange sunset through west windows',
    );
    expect(out).toMatch(/empty classroom/);
    expect(out).toMatch(/dusk/);
    expect(out).toMatch(/warm orange/);
  });

  it('omits lighting clause when absent', () => {
    const out = buildSceneTimeVariantPrompt('garden', 'night');
    expect(out).not.toMatch(/Lighting:/);
  });
});

describe('generateSceneTimeVariant', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'time-variant-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keys the variant separately from the baseline scene', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 't1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/classroom-dusk.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateSceneTimeVariant({
      sceneName: 'classroom',
      baseDescription: 'a spacious school classroom',
      timeOfDay: 'dusk',
      lightingDescription: 'warm low sun through blinds',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.assetType).toBe('scene_time_variant');
    expect(result.entry.logicalKey).toBe('scene:classroom:time:dusk');
    expect(result.entry.realAssetLocalPath).toBe('images/bg/classroom__dusk.png');

    const reloaded = await loadRegistry(registryPath);
    // Baseline scene has its own key `scene:classroom:bg` — not collided here.
    expect(reloaded.entries.map((e) => e.logicalKey)).toEqual([
      'scene:classroom:time:dusk',
    ]);
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ appKey: 'SCENE_BACKGROUND' }),
    );
  });

  it('marks error on failed task', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 't2' }),
      pollTask: vi.fn().mockResolvedValue({ status: 'error', errorMessage: 'boom' }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateSceneTimeVariant({
        sceneName: 'hallway',
        baseDescription: 'school hallway',
        timeOfDay: 'night',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/boom/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.logicalKey).toBe('scene:hallway:time:night');
  });
});
