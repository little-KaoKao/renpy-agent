// 场景设计师:背景图生成入口。结构与 character-designer/generate-main-image 对称,
// 只差 apiId / prompt 组装 / logicalKey 前缀。

import type { RunningHubClient } from '../common/runninghub-client.js';
import { getAppApiId } from '../common/runninghub-schemas.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';

export interface GenerateSceneBackgroundParams {
  readonly sceneName: string;
  readonly description: string;
  readonly timeOfDay?: string;
  readonly styleHint?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateSceneBackgroundResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export function buildSceneBackgroundPrompt(
  description: string,
  timeOfDay?: string,
  styleHint?: string,
): string {
  const style =
    styleHint ?? 'anime visual novel background, wide establishing shot, cinematic lighting';
  const timePart = timeOfDay ? ` (${timeOfDay.trim()})` : '';
  return `${description.trim()}${timePart}. ${style}.`;
}

export async function generateSceneBackground(
  params: GenerateSceneBackgroundParams,
): Promise<GenerateSceneBackgroundResult> {
  const logicalKey = `scene:${slugForFilename(params.sceneName)}:bg`;
  const apiId = getAppApiId('SCENE_BACKGROUND');
  const prompt = buildSceneBackgroundPrompt(
    params.description,
    params.timeOfDay,
    params.styleHint,
  );

  try {
    const task = await runImageTask({
      apiId,
      prompt,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const targetRelativePath = `images/bg/${slugForFilename(params.sceneName)}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'scene_background',
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
      assetType: 'scene_background',
      errorMessage: msg,
    });
    throw err;
  }
}
