import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markAssetError, swapAssetPlaceholder } from './swap.js';
import { loadRegistry, registryPathForGame } from './registry.js';
import type { FetchLike } from './download.js';

function okFetch(body = new Uint8Array([1, 2, 3])): FetchLike {
  return vi.fn(async () =>
    new Response(body, { status: 200 }),
  ) as unknown as FetchLike;
}

describe('swapAssetPlaceholder', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'swap-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('downloads asset and upserts a ready entry', async () => {
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);
    const result = await swapAssetPlaceholder({
      gameDir,
      registryPath,
      logicalKey: 'character:baiying:main',
      assetType: 'character_main',
      remoteUrl: 'https://cdn/b.png',
      targetRelativePath: 'images/char/baiying.png',
      fetchFn: okFetch(),
      now: () => new Date('2026-04-22T00:00:00Z'),
    });

    expect(result.entry.status).toBe('ready');
    expect(result.entry.realAssetLocalPath).toBe('images/char/baiying.png');
    expect(result.entry.remoteAssetUri).toBe('https://cdn/b.png');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0]!.placeholderId).toBe('character_main:character:baiying:main');
  });

  it('is idempotent on repeated calls with the same logicalKey', async () => {
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);
    const base = {
      gameDir,
      registryPath,
      logicalKey: 'scene:sakura:bg',
      assetType: 'scene_background' as const,
      remoteUrl: 'https://cdn/s.png',
      targetRelativePath: 'images/bg/sakura.png',
      fetchFn: okFetch(),
      now: () => new Date('2026-04-22T00:00:00Z'),
    };
    await swapAssetPlaceholder(base);
    await swapAssetPlaceholder({ ...base, remoteUrl: 'https://cdn/s2.png' });
    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0]!.remoteAssetUri).toBe('https://cdn/s2.png');
  });
});

describe('markAssetError', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'swap-err-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates an error entry with errorMessage', async () => {
    const registryPath = join(dir, 'asset-registry.json');
    await markAssetError({
      registryPath,
      logicalKey: 'character:bob:main',
      assetType: 'character_main',
      errorMessage: 'prompt blocked',
      now: () => new Date('2026-04-22T00:00:00Z'),
    });
    const reg = await loadRegistry(registryPath);
    expect(reg.entries[0]!.status).toBe('error');
    expect(reg.entries[0]!.errorMessage).toBe('prompt blocked');
  });
});
