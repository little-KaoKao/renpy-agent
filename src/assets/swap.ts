// Stage B 核心动作:swapAssetPlaceholder
//
// 输入一条逻辑键 + 一个 remote URL,完成:
//   1) 下载到 `<gameDir>/images/...`(POSIX 相对路径)
//   2) upsert registry 条目:status=ready,realAssetLocalPath,remoteAssetUri
//   3) 持久化 registry
//
// 不负责重写 .rpy —— 那是 Coder re-render 的职责(v0.3b 简化做法:Stage B 调 swap 之后调 coder
// 的 render 再写一次)。把 swap 和 re-render 解耦,便于并发下载多个资产再一次性 render。
//
// 并发(v0.7):走 per-entry 文件的 `upsertRegistryEntry`,单条原子 rename。多个 generator
// 并发调 swap/markError 不会抢同一个 JSON,audio-ui / visual-stage 因此能把批次并行化。

import {
  findByLogicalKey,
  loadRegistry,
  upsertRegistryEntry,
} from './registry.js';
import type { AssetRegistryEntry, AssetRegistryFile, AssetType } from './registry.js';
import { downloadAsset, type FetchLike } from './download.js';

export interface SwapAssetPlaceholderParams {
  readonly gameDir: string;
  readonly registryPath: string;
  readonly logicalKey: string;
  readonly assetType: AssetType;
  readonly remoteUrl: string;
  readonly targetRelativePath: string;
  readonly fetchFn?: FetchLike;
  readonly now?: () => Date;
}

export interface SwapAssetPlaceholderResult {
  readonly entry: AssetRegistryEntry;
  readonly registry: AssetRegistryFile;
  readonly byteLength: number;
}

export async function swapAssetPlaceholder(
  params: SwapAssetPlaceholderParams,
): Promise<SwapAssetPlaceholderResult> {
  const now = params.now ?? (() => new Date());

  const { localRelativePath, byteLength } = await downloadAsset({
    remoteUrl: params.remoteUrl,
    gameDir: params.gameDir,
    targetRelativePath: params.targetRelativePath,
    ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
  });

  // Read the current registry only to pick up pre-existing placeholder paths
  // for this entry. We do NOT write the whole registry back — the actual
  // persistence is a single-entry atomic upsert so parallel swaps don't race.
  const loaded = await loadRegistry(params.registryPath);
  const existing = findByLogicalKey(loaded, params.logicalKey);
  const placeholderId =
    existing?.placeholderId ?? `${params.assetType}:${params.logicalKey}`;

  const entry: AssetRegistryEntry = {
    placeholderId,
    logicalKey: params.logicalKey,
    assetType: params.assetType,
    ...(existing?.placeholderImagePath !== undefined
      ? { placeholderImagePath: existing.placeholderImagePath }
      : {}),
    realAssetLocalPath: localRelativePath,
    remoteAssetUri: params.remoteUrl,
    status: 'ready',
    updatedAt: now().toISOString(),
  };
  await upsertRegistryEntry(params.registryPath, entry);

  // Return the post-upsert view so callers that still want a snapshot get one.
  const after = await loadRegistry(params.registryPath);
  return { entry, registry: after, byteLength };
}

/** 失败路径:把 status 打成 error,记下 errorMessage。不抛出。 */
export async function markAssetError(params: {
  readonly registryPath: string;
  readonly logicalKey: string;
  readonly assetType: AssetType;
  readonly errorMessage: string;
  readonly now?: () => Date;
}): Promise<AssetRegistryFile> {
  const now = params.now ?? (() => new Date());
  const loaded = await loadRegistry(params.registryPath);
  const existing = findByLogicalKey(loaded, params.logicalKey);
  const placeholderId =
    existing?.placeholderId ?? `${params.assetType}:${params.logicalKey}`;
  const entry: AssetRegistryEntry = {
    placeholderId,
    logicalKey: params.logicalKey,
    assetType: params.assetType,
    ...(existing?.placeholderImagePath !== undefined
      ? { placeholderImagePath: existing.placeholderImagePath }
      : {}),
    ...(existing?.realAssetLocalPath !== undefined
      ? { realAssetLocalPath: existing.realAssetLocalPath }
      : {}),
    ...(existing?.remoteAssetUri !== undefined
      ? { remoteAssetUri: existing.remoteAssetUri }
      : {}),
    status: 'error',
    errorMessage: params.errorMessage,
    updatedAt: now().toISOString(),
  };
  await upsertRegistryEntry(params.registryPath, entry);
  return loadRegistry(params.registryPath);
}
