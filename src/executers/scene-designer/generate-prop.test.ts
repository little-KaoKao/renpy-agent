import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPropPrompt, generatePropImage } from './generate-prop.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('buildPropPrompt', () => {
  it('includes the object-centric default style', () => {
    expect(buildPropPrompt('a glowing lantern')).toMatch(/centered object/);
  });

  it('respects styleHint', () => {
    expect(buildPropPrompt('teacup', 'ukiyo-e woodblock')).toContain(
      'ukiyo-e woodblock',
    );
  });
});

describe('generatePropImage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prop-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits SCENE_BACKGROUND task and upserts a prop entry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'p1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/lantern.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generatePropImage({
      propName: 'sakura lantern',
      description: 'paper lantern painted with sakura petals',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.assetType).toBe('prop');
    expect(result.entry.logicalKey).toBe('prop:sakura_lantern');
    expect(result.entry.realAssetLocalPath).toBe('images/prop/sakura_lantern.png');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('ready');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ appKey: 'SCENE_BACKGROUND' }),
    );
  });

  it('marks error and rethrows on failed task', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'p2' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'error',
        errorMessage: 'content blocked',
      }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generatePropImage({
        propName: 'forbidden token',
        description: 'whatever',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/content blocked/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.assetType).toBe('prop');
  });
});
