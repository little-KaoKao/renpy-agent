// Stage B 核心动作:swapAssetPlaceholder
//
// 输入一条逻辑键 + 一个 remote URL,完成:
//   1) 下载到 `<gameDir>/images/...`(POSIX 相对路径)
//   2) upsert registry 条目:status=ready,realAssetLocalPath,remoteAssetUri
//   3) 持久化 registry
//
// 不负责重写 .rpy —— 那是 Coder re-render 的职责(v0.3b 简化做法:Stage B 调 swap 之后调 coder
// 的 render 再写一次)。把 swap 和 re-render 解耦,便于并发下载多个资产再一次性 render。

import { findByLogicalKey, loadRegistry, saveRegistry, upsertEntry } from './registry.js';
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
  const next = upsertEntry(loaded, entry);
  await saveRegistry(params.registryPath, next);
  return { entry, registry: next, byteLength };
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
  const next = upsertEntry(loaded, entry);
  await saveRegistry(params.registryPath, next);
  return next;
}
