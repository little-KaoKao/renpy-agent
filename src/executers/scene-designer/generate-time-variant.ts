// 场景设计师:背景的时段/光照变体(例如 classroom 的"黄昏"、"夜晚")。
//
// 和 generate-background 的区别:每个 variant 独立登记 registry(assetType=
// 'scene_time_variant',logicalKey 带 `:time:<slug>` 后缀),共享同一场景 baseline
// 的 prompt 可由 caller 显式串("classroom, dusk, warm orange light")或用默认
// 组合器 `buildSceneTimeVariantPrompt`。
//
// Coder 侧约定:v0.5 不自动识别 time variant(只查 `scene_background`);v0.6+ 在
// Shot 上加 `timeOfDay` 字段后再接线。现在把资产生成先落地,registry 已能区分
// (logicalKey 不冲突)。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';
import { logicalKeyForSceneTimeVariant } from '../../assets/logical-key.js';

export interface GenerateSceneTimeVariantParams {
  readonly sceneName: string;
  readonly baseDescription: string;
  readonly timeOfDay: string;
  readonly lightingDescription?: string;
  readonly styleHint?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateSceneTimeVariantResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export function buildSceneTimeVariantPrompt(
  baseDescription: string,
  timeOfDay: string,
  lightingDescription?: string,
  styleHint?: string,
): string {
  const style =
    styleHint ?? 'anime visual novel background, wide establishing shot, cinematic lighting';
  const lightPart = lightingDescription ? ` Lighting: ${lightingDescription.trim()}.` : '';
  return `${baseDescription.trim()} (${timeOfDay.trim()}).${lightPart} ${style}.`;
}

export async function generateSceneTimeVariant(
  params: GenerateSceneTimeVariantParams,
): Promise<GenerateSceneTimeVariantResult> {
  const logicalKey = logicalKeyForSceneTimeVariant(params.sceneName, params.timeOfDay);
  const prompt = buildSceneTimeVariantPrompt(
    params.baseDescription,
    params.timeOfDay,
    params.lightingDescription,
    params.styleHint,
  );
  const inputs: AiAppNodeInput[] = [{ role: 'prompt', value: prompt }];

  try {
    const task = await runImageTask({
      appKey: 'SCENE_BACKGROUND',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const sceneSlug = slugForFilename(params.sceneName);
    const timeSlug = slugForFilename(params.timeOfDay);
    const targetRelativePath = `images/bg/${sceneSlug}__${timeSlug}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'scene_time_variant',
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
      assetType: 'scene_time_variant',
      errorMessage: msg,
    });
    throw err;
  }
}
