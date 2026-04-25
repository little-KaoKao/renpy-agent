// 角色设计师:主图生成入口。
//
// 目前范围(v0.3b / v0.5+):
//   - 组 prompt(简单串接:visualDescription + 风格 hint)
//   - 调 runImageTask → 拿到 RunningHub 的远端 URL
//   - 调 swapAssetPlaceholder → 下载 + 写 registry
//
// 表情差分 / 动态立绘不在这里,单独函数再加;先让最常用的主图路径通。
//
// 后端:Midjourney v7(`CHARACTER_MAIN_IMAGE` 走 webappId 1941094122503749633),
// prompt 塞角色视觉描述,aspect / model_select 走 schema 默认。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';

export interface GenerateCharacterMainImageParams {
  readonly characterName: string;
  readonly visualDescription: string;
  readonly styleHint?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateCharacterMainImageResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export function buildCharacterMainPrompt(
  visualDescription: string,
  styleHint?: string,
): string {
  const style =
    styleHint ?? 'anime game character reference sheet, full body, neutral pose, clean background';
  return `${visualDescription.trim()}. ${style}.`;
}

export async function generateCharacterMainImage(
  params: GenerateCharacterMainImageParams,
): Promise<GenerateCharacterMainImageResult> {
  const logicalKey = `character:${slugForFilename(params.characterName)}:main`;
  const prompt = buildCharacterMainPrompt(params.visualDescription, params.styleHint);
  const inputs: AiAppNodeInput[] = [{ role: 'prompt', value: prompt }];

  try {
    const task = await runImageTask({
      appKey: 'CHARACTER_MAIN_IMAGE',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const targetRelativePath = `images/char/${slugForFilename(params.characterName)}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'character_main',
      remoteUrl: task.outputUri,
      targetRelativePath,
      ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
    });
    return { entry: swap.entry, remoteUrl: task.outputUri, byteLength: swap.byteLength };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markAssetError({
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'character_main',
      errorMessage: msg,
    });
    throw err;
  }
}
