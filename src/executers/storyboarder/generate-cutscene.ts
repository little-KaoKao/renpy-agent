// 分镜师:Cutscene 视频生成入口。
//
// 视频类资产(过场 / 关键剧情 CG)比图像多两件事:
//  1) 视频体积大 —— 目标落点放在 `videos/cut/` 子目录,与 `images/` 分开。
//  2) 参考图是 URI 流转 —— 调 Seedance2.0 图生视频时,首帧 URI 来自场景设计师
//     (sceneUri)或角色设计师(characterUri)产物,不由分镜师自产。
//
// v0.5+ 起所有 cutscene 统一走 `CUTSCENE_IMAGE_TO_VIDEO`(Seedance2.0 图生视频,
// webappId 2037048798156951553)。旧版本里的 `CUTSCENE_REFERENCE_VIDEO`(多模态
// 视频,带角色+场景参考)已删 —— 实际生产里我们先用 Nanobanana2 把多张参考图合成
// 一张首帧,再喂 Seedance2.0 图生视频,不直接用视频参考。`kind` 依然保留,只是
// 影响 prompt 风格 hint,不切 webappId。
//
// Stage A:本函数不一定被调用(storyboarder 会先把 shot.cutscene 标好,Coder 会按
//          placeholder caption 渲染一个黑幕 + 标题占位,游戏跑得动)。
// Stage B:调用本函数,RunningHub 产视频 URL → 下到 videos/cut/shot_N.mp4 → upsert
//          registry(status=ready),下次 Coder re-render 即可把黑幕换成
//          `$ renpy.movie_cutscene("videos/cut/shot_N.mp4")`。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
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
   * 首帧图 URI。
   * - `transition`:建议喂场景首帧(来自场景设计师),可缺省但效果很差。
   * - `reference`:必填 —— Seedance 图生视频需要一张首帧才能保证画面连贯。
   *
   * v0.5+ 不再接受"视频参考":多图合成首帧应该在 caller 侧先跑 Nanobanana2
   * (`CHARACTER_EXPRESSION` 路径)产出一张合成图,再把 URI 传给这里。
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

export function logicalKeyForCutsceneShot(shotNumber: number): string {
  return `cutscene:shot_${shotNumber}`;
}

export async function generateCutsceneVideo(
  params: GenerateCutsceneVideoParams,
): Promise<GenerateCutsceneVideoResult> {
  const logicalKey = logicalKeyForCutsceneShot(params.shotNumber);
  const prompt = buildCutscenePrompt(params.kind, params.motionPrompt, params.styleHint);

  if (params.kind === 'reference' && !params.referenceImageUri) {
    throw new Error(
      `generateCutsceneVideo: kind="reference" (shot ${params.shotNumber}) requires referenceImageUri`,
    );
  }

  const inputs: AiAppNodeInput[] = [{ role: 'prompt', value: prompt }];
  if (params.referenceImageUri) {
    inputs.push({ role: 'first_frame', value: params.referenceImageUri });
  }

  try {
    const task = await runImageTask({
      appKey: 'CUTSCENE_IMAGE_TO_VIDEO',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    // 产物若是 .bin(推不出扩展名)回退到 .mp4 —— Seedance2.0 默认产 mp4。
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
