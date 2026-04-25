// 场景/道具设计师:道具(单体物品)静态图入口。
//
// 后端:复用 Nanobanana2 文生图(`SCENE_BACKGROUND` AppKey),只改 prompt / 落盘位置 /
// registry 分类。和 generate-background 的区别:
//   - logicalKey 前缀 `prop:`、assetType='prop'
//   - 落 `images/prop/<slug>.<ext>`
//   - 默认构图偏"物体特写 / 透明背景友好"
//
// 不单独开 webappId:道具在 v0.5 范围内产出比例小,复用 Nanobanana2 文生图已够用。
// 真需要 isolated props(例如要干净 alpha)再开独立 AppKey。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';
import { logicalKeyForProp } from '../../assets/logical-key.js';

export interface GeneratePropImageParams {
  readonly propName: string;
  readonly description: string;
  readonly styleHint?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GeneratePropImageResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export function buildPropPrompt(description: string, styleHint?: string): string {
  const style =
    styleHint ??
    'anime visual novel prop, centered object, soft neutral background, clean silhouette';
  return `${description.trim()}. ${style}.`;
}

export async function generatePropImage(
  params: GeneratePropImageParams,
): Promise<GeneratePropImageResult> {
  const logicalKey = logicalKeyForProp(params.propName);
  const prompt = buildPropPrompt(params.description, params.styleHint);
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
    const targetRelativePath = `images/prop/${slugForFilename(params.propName)}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'prop',
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
      assetType: 'prop',
      errorMessage: msg,
    });
    throw err;
  }
}
