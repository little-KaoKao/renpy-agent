import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCharacterMainPrompt,
  generateCharacterMainImage,
} from './generate-main-image.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('buildCharacterMainPrompt', () => {
  it('embeds the default anime game style', () => {
    const out = buildCharacterMainPrompt('pink-haired cheerful girl');
    expect(out).toContain('pink-haired');
    expect(out).toContain('anime game character');
  });

  it('uses styleHint override', () => {
    expect(
      buildCharacterMainPrompt('girl', 'watercolor style'),
    ).toContain('watercolor style');
  });
});

describe('generateCharacterMainImage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'char-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits task, downloads output, and upserts registry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 't1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/character.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateCharacterMainImage({
      characterName: 'Baiying',
      visualDescription: 'pink sakura-haired maiden',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.status).toBe('ready');
    expect(result.entry.realAssetLocalPath).toBe('images/char/baiying.png');
    expect(result.remoteUrl).toBe('https://cdn/character.png');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.logicalKey).toBe('character:baiying:main');
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiId: 'api-448183249',
        prompt: expect.stringContaining('pink sakura-haired'),
      }),
    );
  });

  it('marks error and rethrows on failed task', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 't1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'error',
        errorMessage: 'blocked',
      }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateCharacterMainImage({
        characterName: 'Xyz',
        visualDescription: 'blurb',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/blocked/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.errorMessage).toMatch(/blocked/);
  });
});
