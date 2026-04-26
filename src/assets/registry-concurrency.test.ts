import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ASSET_REGISTRY_DIRNAME,
  ASSET_REGISTRY_FILENAME,
  fileNameForPlaceholderId,
  loadRegistry,
  registryDirForIndex,
  saveRegistry,
  upsertRegistryEntry,
  type AssetRegistryEntry,
} from './registry.js';

function entry(i: number, overrides: Partial<AssetRegistryEntry> = {}): AssetRegistryEntry {
  return {
    placeholderId: `character_main:character:hero_${i}:main`,
    logicalKey: `character:hero_${i}:main`,
    assetType: 'character_main',
    status: 'ready',
    realAssetLocalPath: `images/char/hero_${i}.png`,
    remoteAssetUri: `https://cdn/hero_${i}.png`,
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('registry per-entry files (v0.7 concurrency)', () => {
  let dir: string;
  let registryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'registry-concurrency-'));
    registryPath = resolve(dir, ASSET_REGISTRY_FILENAME);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('upsertRegistryEntry writes one JSON per placeholderId', async () => {
    await upsertRegistryEntry(registryPath, entry(1));
    await upsertRegistryEntry(registryPath, entry(2));

    const entryDir = registryDirForIndex(registryPath);
    const names = await readdir(entryDir);
    expect(names.filter((n) => n.endsWith('.json')).sort()).toEqual([
      fileNameForPlaceholderId(entry(1).placeholderId),
      fileNameForPlaceholderId(entry(2).placeholderId),
    ].sort());

    const loaded = await loadRegistry(registryPath);
    expect(loaded.entries.map((e) => e.placeholderId).sort()).toEqual([
      entry(1).placeholderId,
      entry(2).placeholderId,
    ].sort());
  });

  it('stress: 20 parallel upserts for distinct placeholderIds all survive', async () => {
    const items = Array.from({ length: 20 }, (_, i) => entry(i));
    await Promise.all(items.map((e) => upsertRegistryEntry(registryPath, e)));

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries).toHaveLength(20);
    const keys = new Set(reloaded.entries.map((e) => e.placeholderId));
    for (const it of items) expect(keys.has(it.placeholderId)).toBe(true);
  });

  it('same-id race: result equals one of the competing entries (no merge, no crash)', async () => {
    const a = entry(7, { remoteAssetUri: 'https://cdn/a.png', updatedAt: '2026-04-26T00:00:00.001Z' });
    const b = entry(7, { remoteAssetUri: 'https://cdn/b.png', updatedAt: '2026-04-26T00:00:00.002Z' });
    // Same placeholderId (`character_main:character:hero_7:main`).
    await Promise.all([
      upsertRegistryEntry(registryPath, a),
      upsertRegistryEntry(registryPath, b),
    ]);
    const loaded = await loadRegistry(registryPath);
    expect(loaded.entries).toHaveLength(1);
    const got = loaded.entries[0]!;
    expect([a.remoteAssetUri, b.remoteAssetUri]).toContain(got.remoteAssetUri);
  });

  it('saveRegistry prunes stale per-entry files that are not in the new snapshot', async () => {
    await upsertRegistryEntry(registryPath, entry(1));
    await upsertRegistryEntry(registryPath, entry(2));
    await saveRegistry(registryPath, { version: 1, entries: [entry(2)] });

    const entryDir = registryDirForIndex(registryPath);
    const names = (await readdir(entryDir)).filter((n) => n.endsWith('.json') && !n.endsWith('.tmp'));
    expect(names).toEqual([fileNameForPlaceholderId(entry(2).placeholderId)]);
  });

  it('malformed per-entry files are skipped during load instead of crashing', async () => {
    await upsertRegistryEntry(registryPath, entry(1));
    const entryDir = registryDirForIndex(registryPath);
    await writeFile(resolve(entryDir, 'not-json.json'), '{not valid', 'utf8');

    const loaded = await loadRegistry(registryPath);
    expect(loaded.entries.map((e) => e.placeholderId)).toEqual([entry(1).placeholderId]);
  });

  it('legacy migration: a v0.6 single-file registry is exploded into per-entry files on first upsert', async () => {
    // Seed only the legacy single file; no per-entry dir yet.
    const legacy: AssetRegistryEntry[] = [entry(1), entry(2)];
    await writeFile(
      registryPath,
      JSON.stringify({ version: 1, entries: legacy }, null, 2),
      'utf8',
    );

    // First upsert triggers migration + writes the new entry.
    await upsertRegistryEntry(registryPath, entry(3));

    const entryDir = registryDirForIndex(registryPath);
    const names = (await readdir(entryDir))
      .filter((n) => n.endsWith('.json') && !n.endsWith('.tmp'))
      .sort();
    expect(names).toEqual(
      [
        fileNameForPlaceholderId(entry(1).placeholderId),
        fileNameForPlaceholderId(entry(2).placeholderId),
        fileNameForPlaceholderId(entry(3).placeholderId),
      ].sort(),
    );

    const loaded = await loadRegistry(registryPath);
    expect(loaded.entries).toHaveLength(3);
  });

  it('legacy-only load: loadRegistry returns old single-file entries when dir is absent', async () => {
    const legacy = entry(42);
    await writeFile(
      registryPath,
      JSON.stringify({ version: 1, entries: [legacy] }, null, 2),
      'utf8',
    );
    // Note: no asset-registry/ directory here — pure legacy v0.6 layout.
    const loaded = await loadRegistry(registryPath);
    expect(loaded.entries).toEqual([legacy]);
  });

  it('index file reflects the per-entry dir snapshot after upsert', async () => {
    await upsertRegistryEntry(registryPath, entry(1));
    await upsertRegistryEntry(registryPath, entry(2));

    const raw = await readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as { version: number; entries: AssetRegistryEntry[] };
    expect(parsed.version).toBe(1);
    expect(parsed.entries.map((e) => e.placeholderId).sort()).toEqual([
      entry(1).placeholderId,
      entry(2).placeholderId,
    ].sort());
  });

  it('uses URL-encoded filenames so Windows-illegal chars (":") are safe', async () => {
    // placeholderId always contains `:` today. Verify the filename on disk is encoded.
    await upsertRegistryEntry(registryPath, entry(1));
    const entryDir = registryDirForIndex(registryPath);
    const names = await readdir(entryDir);
    for (const n of names) {
      if (n.endsWith('.tmp')) continue;
      expect(n.includes(':')).toBe(false);
    }
    // Round-trip: encoded filename decodes to the original placeholderId.
    const expected = fileNameForPlaceholderId(entry(1).placeholderId);
    expect(names).toContain(expected);
  });

  it('no .tmp files linger after successful upserts', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertRegistryEntry(registryPath, entry(i));
    }
    const entryDir = registryDirForIndex(registryPath);
    const leftover = (await readdir(entryDir)).filter((n) => n.endsWith('.tmp'));
    expect(leftover).toEqual([]);
  });

  it('registryDirForIndex sits next to the index file', async () => {
    const path = resolve(dir, 'asset-registry.json');
    expect(registryDirForIndex(path).replaceAll('\\', '/')).toMatch(
      new RegExp(`/${ASSET_REGISTRY_DIRNAME}$`),
    );
    // and the sibling dir actually gets created after an upsert
    await upsertRegistryEntry(path, entry(1));
    const entryDirStat = await stat(registryDirForIndex(path));
    expect(entryDirStat.isDirectory()).toBe(true);
  });
});
