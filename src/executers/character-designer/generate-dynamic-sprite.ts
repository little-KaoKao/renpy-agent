// 角色设计师:动态立绘(轻微 idle 动画)生成入口。
//
// 后端:Seedance2.0 图生视频(`CHARACTER_DYNAMIC_SPRITE` 走 webappId 2037048798156951553)。
// 典型 prompt: "gentle breathing, subtle blinking"。首帧必传 —— 来自角色主图的 URL。
//
// logicalKey 独立(`character:<slug>:dynamic`),不与主图 / 表情差分冲突。落盘在
// `videos/char/<slug>.<ext>`(Seedance 默认产 mp4)。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';
import { logicalKeyForCharacterDynamicSprite } from '../../assets/logical-key.js';

export interface GenerateCharacterDynamicSpriteParams {
  readonly characterName: string;
  readonly firstFrameImageUri: string;
  readonly motionPrompt?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateCharacterDynamicSpriteResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

const DEFAULT_MOTION_PROMPT =
  'gentle breathing, subtle blinking, slight shoulder movement, consistent character appearance';

export async function generateCharacterDynamicSprite(
  params: GenerateCharacterDynamicSpriteParams,
): Promise<GenerateCharacterDynamicSpriteResult> {
  if (!params.firstFrameImageUri) {
    throw new Error(
      'generateCharacterDynamicSprite: firstFrameImageUri is required (pass the character main image URL)',
    );
  }
  const logicalKey = logicalKeyForCharacterDynamicSprite(params.characterName);
  const inputs: AiAppNodeInput[] = [
    { role: 'prompt', value: params.motionPrompt ?? DEFAULT_MOTION_PROMPT },
    { role: 'first_frame', value: params.firstFrameImageUri },
  ];

  try {
    const task = await runImageTask({
      appKey: 'CHARACTER_DYNAMIC_SPRITE',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const finalExt = ext === '.bin' ? '.mp4' : ext;
    const targetRelativePath = `videos/char/${slugForFilename(params.characterName)}${finalExt}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'character_dynamic_sprite',
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
      assetType: 'character_dynamic_sprite',
      errorMessage: msg,
    });
    throw err;
  }
}
