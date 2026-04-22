import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appKeyForCutscene,
  buildCutscenePrompt,
  generateCutsceneVideo,
  logicalKeyForCutsceneShot,
} from './generate-cutscene.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('buildCutscenePrompt', () => {
  it('uses a transition style by default for transition kind', () => {
    const out = buildCutscenePrompt('transition', 'slow dolly');
    expect(out).toContain('slow dolly');
    expect(out.toLowerCase()).toContain('transition');
  });

  it('uses a reference/key-frame style by default for reference kind', () => {
    const out = buildCutscenePrompt('reference', 'tearful embrace');
    expect(out).toContain('tearful embrace');
    expect(out.toLowerCase()).toContain('reference');
  });

  it('respects styleHint override', () => {
    expect(
      buildCutscenePrompt('transition', 'sweep', 'retro 90s film grain'),
    ).toContain('retro 90s film grain');
  });
});

describe('appKeyForCutscene', () => {
  it('maps transition → CUTSCENE_IMAGE_TO_VIDEO', () => {
    expect(appKeyForCutscene('transition')).toBe('CUTSCENE_IMAGE_TO_VIDEO');
  });
  it('maps reference → CUTSCENE_REFERENCE_VIDEO', () => {
    expect(appKeyForCutscene('reference')).toBe('CUTSCENE_REFERENCE_VIDEO');
  });
});

describe('logicalKeyForCutsceneShot', () => {
  it('includes the shot number for stable Stage A ↔ B binding', () => {
    expect(logicalKeyForCutsceneShot(3)).toBe('cutscene:shot_3');
  });
});

describe('generateCutsceneVideo', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cutscene-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits transition task, downloads mp4, upserts registry with cutscene type', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'v1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/transition.mp4',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateCutsceneVideo({
      shotNumber: 2,
      kind: 'transition',
      motionPrompt: 'slow dolly through cherry blossoms',
      referenceImageUri: 'https://cdn/scene-first-frame.jpg',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.assetType).toBe('cutscene');
    expect(result.entry.status).toBe('ready');
    expect(result.entry.realAssetLocalPath).toBe('videos/cut/shot_2.mp4');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.logicalKey).toBe('cutscene:shot_2');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiId: 'api-425766645', // CUTSCENE_IMAGE_TO_VIDEO
        referenceImageUri: 'https://cdn/scene-first-frame.jpg',
      }),
    );
  });

  it('falls back to .mp4 when URL has no recognizable extension', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'v2' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/output?taskId=v2', // no .ext
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateCutsceneVideo({
      shotNumber: 7,
      kind: 'reference',
      motionPrompt: 'kiss under the moon',
      referenceImageUri: 'https://cdn/ref.jpg',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.realAssetLocalPath).toBe('videos/cut/shot_7.mp4');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ apiId: 'api-437377723' }), // CUTSCENE_REFERENCE_VIDEO
    );
  });

  it('rejects reference kind without referenceImageUri', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn(),
      pollTask: vi.fn(),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateCutsceneVideo({
        shotNumber: 1,
        kind: 'reference',
        motionPrompt: 'fight scene',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/referenceImageUri/);

    expect(client.submitTask).not.toHaveBeenCalled();
    // error branch does not write registry because we never submitted
    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries).toHaveLength(0);
  });

  it('marks error and rethrows on failed RunningHub task', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'v3' }),
      pollTask: vi.fn().mockResolvedValue({ status: 'error', errorMessage: 'moderation' }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateCutsceneVideo({
        shotNumber: 4,
        kind: 'transition',
        motionPrompt: 'ending credits fade',
        referenceImageUri: 'https://cdn/ending.jpg',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/moderation/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.logicalKey).toBe('cutscene:shot_4');
  });
});
