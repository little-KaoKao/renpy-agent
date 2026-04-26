// AssetRegistry:Stage A / Stage B 切换的账本。
//
// 每个 placeholderId 对应一个条目,记录:
//   - logicalKey:逻辑身份(例如 `character:baiying:main`),跨 Stage 稳定
//   - assetType:方便按类型批量查(character / scene / …)
//   - placeholderImagePath:Coder 生成时落下的 Solid/Transform 占位路径(可选,视频类型为空)
//   - realAssetLocalPath:Stage B 把真资产下载到本地后的路径(纯 posix 相对路径,Ren'Py 需要)
//   - remoteAssetUri:RunningHub 产物的原始 URL(审计用)
//   - status:'placeholder' | 'generating' | 'ready' | 'error'
//
// 持久化(v0.7 并发改造,方案 A:per-entry 文件):
//   - 权威存储:`<gameDir>/../asset-registry/<urlEncodedPlaceholderId>.json`,每个条目一个文件
//   - 兼容索引:`<gameDir>/../asset-registry.json`(单文件聚合),每次 save 时全量重写
//     — 读的时候优先扫目录,目录缺失时再回落到单文件(v0.6 老产物迁移入口)
//   - 单条 upsert 用 `write-to-tmp + rename` 原子替换,天然并发安全
// Pure I/O + 内存结构,不依赖 sqlite,开发期调试友好。

import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export type AssetType =
  | 'character_main'
  | 'character_expression'
  | 'character_dynamic_sprite'
  | 'scene_background'
  | 'scene_time_variant'
  | 'prop'
  | 'cutscene'
  | 'bgm_track'
  | 'voice_line'
  | 'sfx';

export type AssetStatus = 'placeholder' | 'generating' | 'ready' | 'error';

export interface AssetRegistryEntry {
  readonly placeholderId: string;
  readonly logicalKey: string;
  readonly assetType: AssetType;
  readonly placeholderImagePath?: string;
  readonly realAssetLocalPath?: string;
  readonly remoteAssetUri?: string;
  readonly status: AssetStatus;
  readonly errorMessage?: string;
  readonly updatedAt: string;
}

export interface AssetRegistryFile {
  readonly version: 1;
  readonly entries: ReadonlyArray<AssetRegistryEntry>;
}

export const ASSET_REGISTRY_FILENAME = 'asset-registry.json';
/** Sibling directory holding one JSON file per entry (authoritative since v0.7). */
export const ASSET_REGISTRY_DIRNAME = 'asset-registry';

/** Given a game directory (`<gameRoot>/game`), return the legacy index file path. */
export function registryPathForGame(gameDir: string): string {
  return resolve(dirname(gameDir), ASSET_REGISTRY_FILENAME);
}

/** Given an index file path, return the sibling per-entry directory. */
export function registryDirForIndex(registryPath: string): string {
  return resolve(dirname(registryPath), ASSET_REGISTRY_DIRNAME);
}

export async function loadRegistry(registryPath: string): Promise<AssetRegistryFile> {
  const dir = registryDirForIndex(registryPath);
  const fromDir = await tryLoadFromDir(dir);
  if (fromDir) return fromDir;
  // Directory missing or empty — fall back to the legacy single file (v0.6
  // projects) so existing data is visible on first run of v0.7.
  return tryLoadFromFile(registryPath);
}

/**
 * Persist the registry snapshot in **both** places: per-entry files (authoritative)
 * and the single-file index (compatibility + resume cache). Only files that
 * still exist in `registry.entries` survive; stale per-entry files are pruned.
 *
 * This is a whole-registry rewrite. For single-entry mutations in a concurrent
 * pipeline, prefer `upsertRegistryEntry` — it does not read or rewrite other
 * entries, so two workers touching different placeholderIds never collide.
 */
export async function saveRegistry(
  registryPath: string,
  registry: AssetRegistryFile,
): Promise<void> {
  const dir = registryDirForIndex(registryPath);
  await mkdir(dir, { recursive: true });

  const wanted = new Set<string>();
  for (const entry of registry.entries) {
    const fileName = fileNameForPlaceholderId(entry.placeholderId);
    wanted.add(fileName);
    await writeEntryFileAtomic(resolve(dir, fileName), entry);
  }
  await pruneOtherEntries(dir, wanted);

  await writeFile(
    registryPath,
    JSON.stringify(registry, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Concurrency-safe single-entry upsert.
 *
 * - Writes the per-entry file atomically (tmp + rename).
 * - Does NOT read or rewrite other entries — two workers acting on different
 *   placeholderIds never collide.
 * - For the same placeholderId: last writer wins (rename is atomic on all
 *   supported platforms). Callers that need merge semantics must read the old
 *   entry first and include its fields in `entry`.
 * - Also refreshes the legacy index file as a best-effort cache; if two
 *   upserts race on the index, the later one will rewrite it — either view is
 *   a valid snapshot (per-entry dir is the source of truth). Index refresh
 *   failures are swallowed to not poison the actual upsert.
 */
export async function upsertRegistryEntry(
  registryPath: string,
  entry: AssetRegistryEntry,
): Promise<void> {
  const dir = registryDirForIndex(registryPath);
  await mkdir(dir, { recursive: true });
  // If this project still has a legacy single-file-only registry, migrate it
  // to the directory *before* writing the new entry so we don't lose old rows.
  await migrateLegacyFileIfNeeded(registryPath, dir);

  const target = resolve(dir, fileNameForPlaceholderId(entry.placeholderId));
  await writeEntryFileAtomic(target, entry);

  // Refresh the index file as a best-effort cache. Two concurrent upserts may
  // race here; whichever finishes last reflects the directory snapshot at
  // that moment. The authoritative answer always comes from scanning the dir.
  try {
    const snapshot = await loadRegistry(registryPath);
    await writeFile(
      registryPath,
      JSON.stringify(snapshot, null, 2) + '\n',
      'utf8',
    );
  } catch {
    // Index refresh is best-effort; swallow to not mask upsert success.
  }
}

/** Idempotent upsert on an in-memory registry. Has NO I/O. */
export function upsertEntry(
  registry: AssetRegistryFile,
  entry: AssetRegistryEntry,
): AssetRegistryFile {
  const idx = registry.entries.findIndex((e) => e.placeholderId === entry.placeholderId);
  const next = [...registry.entries];
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  return { ...registry, entries: next };
}

export function findByLogicalKey(
  registry: AssetRegistryFile,
  logicalKey: string,
): AssetRegistryEntry | undefined {
  return registry.entries.find((e) => e.logicalKey === logicalKey);
}

export function findByPlaceholderId(
  registry: AssetRegistryFile,
  placeholderId: string,
): AssetRegistryEntry | undefined {
  return registry.entries.find((e) => e.placeholderId === placeholderId);
}

export function computePlaceholderId(assetType: AssetType, logicalKey: string): string {
  return `${assetType}:${logicalKey}`;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * placeholderId can contain `:` and other chars that are illegal in Windows
 * filenames, so we URL-encode it. Plain ASCII slugs like `character_main:x`
 * round-trip cleanly: `character_main%3Ax.json`.
 */
export function fileNameForPlaceholderId(placeholderId: string): string {
  return `${encodeURIComponent(placeholderId)}.json`;
}

export function placeholderIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith('.json')) return undefined;
  const stem = fileName.slice(0, -'.json'.length);
  try {
    return decodeURIComponent(stem);
  } catch {
    return undefined;
  }
}

async function writeEntryFileAtomic(
  target: string,
  entry: AssetRegistryEntry,
): Promise<void> {
  // Unique per-call suffix so two workers writing the same target never share
  // a tmp path — the rename is what provides atomicity, not the tmp name.
  const suffix = `${process.pid}.${randomBytes(6).toString('hex')}`;
  const tmp = `${target}.${suffix}.tmp`;
  const body = JSON.stringify(entry, null, 2) + '\n';
  await writeFile(tmp, body, 'utf8');
  try {
    await renameWithRetry(tmp, target);
  } catch (err) {
    // Best-effort cleanup of the leftover tmp on rename failure.
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Windows quirk: when two processes race to `rename(_, target)` and `target`
 * is momentarily open by the other process, the second rename fails with
 * EPERM / EACCES / EBUSY. POSIX has no such issue. We retry with a tiny
 * backoff — the contention window is microseconds long in practice.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const maxAttempts = 10;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!isTransientRenameError(err)) throw err;
      // Short, randomized backoff so concurrent retriers don't lockstep.
      const ms = 2 + Math.floor(Math.random() * 6);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  throw lastErr;
}

function isTransientRenameError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as { code: string }).code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

async function tryLoadFromDir(dir: string): Promise<AssetRegistryFile | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return undefined;
    throw err;
  }
  const entries: AssetRegistryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (name.endsWith('.tmp')) continue;
    const full = resolve(dir, name);
    let text: string;
    try {
      text = await readFile(full, 'utf8');
    } catch (err) {
      // The file may have been removed between readdir and readFile (e.g. by
      // a concurrent migration or prune). Treat as "not there" rather than
      // crashing the whole load.
      if (isFileNotFound(err)) continue;
      throw err;
    }
    try {
      const parsed = JSON.parse(text) as AssetRegistryEntry;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.placeholderId !== 'string') {
        continue;
      }
      entries.push(parsed);
    } catch {
      // Malformed file (e.g. truncated write) — skip. The next upsert for that
      // placeholderId will overwrite it.
    }
  }
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => a.placeholderId.localeCompare(b.placeholderId));
  return { version: 1, entries };
}

async function tryLoadFromFile(registryPath: string): Promise<AssetRegistryFile> {
  try {
    const text = await readFile(registryPath, 'utf8');
    const parsed = JSON.parse(text) as AssetRegistryFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error(`malformed registry at ${registryPath}`);
    }
    return parsed;
  } catch (err) {
    if (isFileNotFound(err)) {
      return { version: 1, entries: [] };
    }
    throw err;
  }
}

/**
 * v0.6 → v0.7 migration: if there's no entry directory but an old single-file
 * registry exists, explode it into per-entry files before the first upsert so
 * we don't strand old data.
 *
 * We only migrate when the directory has no entry files (first upsert on an
 * upgraded project). After migration subsequent upserts hit the per-entry
 * path directly and never re-enter this branch.
 */
async function migrateLegacyFileIfNeeded(
  registryPath: string,
  dir: string,
): Promise<void> {
  let existing: string[] = [];
  try {
    existing = await readdir(dir);
  } catch (err) {
    if (!isFileNotFound(err)) throw err;
  }
  const hasEntryFiles = existing.some(
    (n) => n.endsWith('.json') && !n.endsWith('.tmp'),
  );
  if (hasEntryFiles) return;

  const legacy = await tryLoadFromFile(registryPath);
  if (legacy.entries.length === 0) return;

  await mkdir(dir, { recursive: true });
  for (const entry of legacy.entries) {
    const target = resolve(dir, fileNameForPlaceholderId(entry.placeholderId));
    await writeEntryFileAtomic(target, entry);
  }
}

async function pruneOtherEntries(
  dir: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isFileNotFound(err)) return;
    throw err;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (name.endsWith('.tmp')) continue;
    if (keep.has(name)) continue;
    try {
      await rm(resolve(dir, name), { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
