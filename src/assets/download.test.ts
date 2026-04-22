import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadAsset,
  inferExtensionFromUrl,
  normalizeRelative,
  slugForFilename,
  type FetchLike,
} from './download.js';

describe('path helpers', () => {
  it('inferExtensionFromUrl handles common image/video extensions', () => {
    expect(inferExtensionFromUrl('https://cdn/x.png')).toBe('.png');
    expect(inferExtensionFromUrl('https://cdn/x.MP4?x=1')).toBe('.mp4');
    expect(inferExtensionFromUrl('https://cdn/oddball.zzz')).toBe('.bin');
    expect(inferExtensionFromUrl('https://cdn/no-ext')).toBe('.bin');
  });

  it('normalizeRelative flattens Windows separators', () => {
    expect(normalizeRelative('images\\char\\a.png')).toBe('images/char/a.png');
    expect(normalizeRelative('./images/bg/a.png')).toBe('images/bg/a.png');
    expect(normalizeRelative('/images/a.png')).toBe('images/a.png');
  });

  it('slugForFilename is ascii lowercase', () => {
    expect(slugForFilename('Baiying 白樱')).toBe('baiying');
    expect(slugForFilename('!!!')).toBe('asset');
  });
});

describe('downloadAsset', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'download-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the fetched payload to the target path', async () => {
    const payload = new Uint8Array([137, 80, 78, 71]); // PNG magic
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(payload, { status: 200 }),
    ) as unknown as FetchLike;

    const res = await downloadAsset({
      remoteUrl: 'https://cdn/asset.png',
      gameDir: dir,
      targetRelativePath: 'images/char/baiying.png',
      fetchFn,
    });

    expect(res.byteLength).toBe(4);
    expect(res.localRelativePath).toBe('images/char/baiying.png');
    const written = await readFile(join(dir, 'images', 'char', 'baiying.png'));
    expect([...written]).toEqual([137, 80, 78, 71]);
  });

  it('throws on non-2xx', async () => {
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response('nope', { status: 404 }),
    ) as unknown as FetchLike;
    await expect(
      downloadAsset({
        remoteUrl: 'https://cdn/404.png',
        gameDir: dir,
        targetRelativePath: 'images/x.png',
        fetchFn,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
