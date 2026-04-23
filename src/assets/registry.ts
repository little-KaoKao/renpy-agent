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
// 持久化:JSON 文件,每个游戏一份,固定写到 `<gameDir>/../asset-registry.json`(游戏目录兄弟位,
// 避开 Ren'Py 打包时扫 `.rpa` 的范围)。
// Pure I/O + 内存结构,不依赖 sqlite,开发期调试友好。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

/** 给一个游戏目录(`<gameRoot>/game`),返回它的 registry 绝对路径。 */
export function registryPathForGame(gameDir: string): string {
  return resolve(dirname(gameDir), ASSET_REGISTRY_FILENAME);
}

export async function loadRegistry(registryPath: string): Promise<AssetRegistryFile> {
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

export async function saveRegistry(
  registryPath: string,
  registry: AssetRegistryFile,
): Promise<void> {
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

/** 幂等 upsert:有同 placeholderId 就替换,没有就追加。 */
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

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
