// 资产下载工具:把 RunningHub 产物 URL 下到游戏目录的 images/ 子目录下。
//
// Ren'Py 要求图片路径相对 game/ 目录(且用 POSIX 斜杠),所以 realAssetLocalPath 统一存相对路径。

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DownloadAssetParams {
  readonly remoteUrl: string;
  /** 游戏目录,即 `<gameRoot>/game`。 */
  readonly gameDir: string;
  /** 相对 `gameDir` 的目标路径(POSIX 斜杠,如 `images/char/baiying.png`)。 */
  readonly targetRelativePath: string;
  readonly fetchFn?: FetchLike;
}

export interface DownloadAssetResult {
  readonly localRelativePath: string;
  readonly byteLength: number;
}

export async function downloadAsset(params: DownloadAssetParams): Promise<DownloadAssetResult> {
  const fetchFn = params.fetchFn ?? (globalThis.fetch as FetchLike);
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is not available; pass fetchFn or run on Node 18+.');
  }
  const relativePath = normalizeRelative(params.targetRelativePath);
  const absTarget = resolve(params.gameDir, relativePath);

  const res = await fetchFn(params.remoteUrl);
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} for ${params.remoteUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  await mkdir(dirname(absTarget), { recursive: true });
  await writeFile(absTarget, buf);
  return { localRelativePath: relativePath, byteLength: buf.byteLength };
}

/** 把 Windows 反斜杠扁平化成 POSIX;去掉前导 `./` 和斜杠。 */
export function normalizeRelative(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** 根据 URL 或 content-type 推断扩展名。保守:认不出就给 `.bin`。 */
export function inferExtensionFromUrl(url: string): string {
  const m = url.match(/\.([a-zA-Z0-9]{1,5})(?:\?|$)/);
  if (!m) return '.bin';
  const ext = m[1]!.toLowerCase();
  const allowed = new Set([
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp',
    'mp4', 'webm', 'mov', 'avi',
    'mp3', 'ogg', 'wav', 'flac',
  ]);
  return allowed.has(ext) ? `.${ext}` : '.bin';
}

// Hash fallback for names whose ASCII projection is empty (pure CJK, emoji, …).
// Two distinct CJK names — e.g. "白樱" vs "樱白" — used to both collapse onto
// the literal fallback 'asset' and then collide on `characters/asset.json`.
// Using a stable SHA-1 of the raw value keeps them distinct across runs.
export function slugForFilename(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii) return ascii;
  const hash = createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 8);
  return `char_${hash}`;
}
