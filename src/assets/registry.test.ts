import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ASSET_REGISTRY_FILENAME,
  computePlaceholderId,
  findByLogicalKey,
  findByPlaceholderId,
  loadRegistry,
  registryPathForGame,
  saveRegistry,
  upsertEntry,
  type AssetRegistryEntry,
} from './registry.js';

describe('registry persistence', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'registry-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loadRegistry returns empty registry when file missing', async () => {
    const p = join(dir, ASSET_REGISTRY_FILENAME);
    const reg = await loadRegistry(p);
    expect(reg).toEqual({ version: 1, entries: [] });
  });

  it('round-trips through save + load', async () => {
    const p = join(dir, ASSET_REGISTRY_FILENAME);
    const entry: AssetRegistryEntry = {
      placeholderId: 'character_main:baiying',
      logicalKey: 'character:baiying:main',
      assetType: 'character_main',
      realAssetLocalPath: 'images/char/baiying.png',
      remoteAssetUri: 'https://cdn/baiying.png',
      status: 'ready',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    await saveRegistry(p, { version: 1, entries: [entry] });
    const reloaded = await loadRegistry(p);
    expect(reloaded.entries).toEqual([entry]);
  });

  it('upsertEntry replaces by placeholderId', () => {
    const base: AssetRegistryEntry = {
      placeholderId: 'x',
      logicalKey: 'x',
      assetType: 'scene_background',
      status: 'placeholder',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const reg = { version: 1 as const, entries: [base] };
    const updated = upsertEntry(reg, { ...base, status: 'ready' });
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0]!.status).toBe('ready');
  });

  it('findByLogicalKey / findByPlaceholderId', () => {
    const entry: AssetRegistryEntry = {
      placeholderId: 'p1',
      logicalKey: 'character:baiying:main',
      assetType: 'character_main',
      status: 'ready',
      updatedAt: '2026-04-22T00:00:00.000Z',
    };
    const reg = { version: 1 as const, entries: [entry] };
    expect(findByPlaceholderId(reg, 'p1')).toBe(entry);
    expect(findByLogicalKey(reg, 'character:baiying:main')).toBe(entry);
    expect(findByLogicalKey(reg, 'nope')).toBeUndefined();
  });

  it('registryPathForGame places the file next to game/', () => {
    const p = registryPathForGame('/tmp/runtime/games/demo/game');
    expect(p.replaceAll('\\', '/')).toMatch(/\/tmp\/runtime\/games\/demo\/asset-registry\.json$/);
  });

  it('computePlaceholderId concatenates type and key', () => {
    expect(computePlaceholderId('scene_background', 'scene:sakura:bg')).toBe(
      'scene_background:scene:sakura:bg',
    );
  });

  it('saveRegistry pretty-prints with trailing newline', async () => {
    const p = join(dir, ASSET_REGISTRY_FILENAME);
    await saveRegistry(p, { version: 1, entries: [] });
    const raw = await readFile(p, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "version": 1');
  });
});
