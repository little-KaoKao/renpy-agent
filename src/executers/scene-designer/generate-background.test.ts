import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSceneBackgroundPrompt,
  generateSceneBackground,
} from './generate-background.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('buildSceneBackgroundPrompt', () => {
  it('appends timeOfDay when given', () => {
    const out = buildSceneBackgroundPrompt('sakura courtyard', 'dusk');
    expect(out).toContain('sakura courtyard');
    expect(out).toContain('(dusk)');
  });

  it('omits parentheses when timeOfDay missing', () => {
    expect(buildSceneBackgroundPrompt('sakura courtyard')).not.toContain('(');
  });
});

describe('generateSceneBackground', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scene-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits task, downloads output, and upserts registry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 's1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/scene.jpg',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1, 2]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateSceneBackground({
      sceneName: 'Sakura Courtyard',
      description: 'moonlit courtyard with falling petals',
      timeOfDay: 'night',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.status).toBe('ready');
    expect(result.entry.realAssetLocalPath).toBe('images/bg/sakura_courtyard.jpg');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.assetType).toBe('scene_background');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ apiId: 'api-425766751' }),
    );
  });
});
