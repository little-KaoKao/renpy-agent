// 分镜师:Cutscene 视频生成入口。
//
// 视频类资产(过场 / 关键剧情 CG)比图像多两件事:
//  1) 视频体积大 —— 目标落点放在 `videos/cut/` 子目录,与 `images/` 分开。
//  2) 参考图是 URI 流转 —— 调 Vidu-参考生视频-q3 类模型时,referenceImageUri 来自
//     场景设计师(sceneUri)或角色设计师(characterUri)产物,不由分镜师自产。
//
// Stage A:本函数不一定被调用(storyboarder 会先把 shot.cutscene 标好,Coder 会按
//          placeholder caption 渲染一个黑幕 + 标题占位,游戏跑得动)。
// Stage B:调用本函数,RunningHub 产视频 URL → 下到 videos/cut/shot_N.mp4 → upsert
//          registry(status=ready),下次 Coder re-render 即可把黑幕换成
//          `$ renpy.movie_cutscene("videos/cut/shot_N.mp4")`。

import type { RunningHubClient } from '../common/runninghub-client.js';
import { getAppApiId, type RunningHubAppKey } from '../common/runninghub-schemas.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';

export type CutsceneKind = 'transition' | 'reference';

export interface GenerateCutsceneVideoParams {
  readonly shotNumber: number;
  readonly kind: CutsceneKind;
  readonly motionPrompt: string;
  readonly styleHint?: string;
  /**
   * 参考图 URI。`transition` 建议喂场景首帧;`reference` 必须提供(否则 RunningHub
   * 那端的参考图 node 会空)。
   */
  readonly referenceImageUri?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateCutsceneVideoResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export function buildCutscenePrompt(
  kind: CutsceneKind,
  motionPrompt: string,
  styleHint?: string,
): string {
  const style =
    styleHint ??
    (kind === 'transition'
      ? 'cinematic anime visual novel transition, slow camera, soft light grade'
      : 'dramatic anime key-frame animation, character-consistent with the reference');
  return `${motionPrompt.trim()}. ${style}.`;
}

export function appKeyForCutscene(kind: CutsceneKind): RunningHubAppKey {
  return kind === 'transition' ? 'CUTSCENE_IMAGE_TO_VIDEO' : 'CUTSCENE_REFERENCE_VIDEO';
}

export function logicalKeyForCutsceneShot(shotNumber: number): string {
  return `cutscene:shot_${shotNumber}`;
}

export async function generateCutsceneVideo(
  params: GenerateCutsceneVideoParams,
): Promise<GenerateCutsceneVideoResult> {
  const logicalKey = logicalKeyForCutsceneShot(params.shotNumber);
  const apiId = getAppApiId(appKeyForCutscene(params.kind));
  const prompt = buildCutscenePrompt(params.kind, params.motionPrompt, params.styleHint);

  if (params.kind === 'reference' && !params.referenceImageUri) {
    throw new Error(
      `generateCutsceneVideo: kind="reference" (shot ${params.shotNumber}) requires referenceImageUri`,
    );
  }

  try {
    const task = await runImageTask({
      apiId,
      prompt,
      client: params.client,
      ...(params.referenceImageUri !== undefined
        ? { referenceImageUri: params.referenceImageUri }
        : {}),
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    // 产物若是 .bin(推不出扩展名)回退到 .mp4 —— Vidu / Wan 默认都产 mp4。
    const finalExt = ext === '.bin' ? '.mp4' : ext;
    const targetRelativePath = `videos/cut/shot_${params.shotNumber}${finalExt}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'cutscene',
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
      assetType: 'cutscene',
      errorMessage: msg,
    });
    throw err;
  }
}
