// 音乐总监:BGM 生成入口。
//
// 后端:RunningHub SunoV5(`BGM_TRACK` 走 webappId 1972977443998928898),
// 字段布局 nodeId=13/text=title、nodeId=14/text=prompt、nodeId=1/version=v4.5。
// Ren'Py 端的 `play music` 走这里产出的 mp3。
//
// 结构与 character-designer / scene-designer 对称:submit → poll → swap + registry。
// 差异:
//   - appKey='BGM_TRACK',assetType='bgm_track'
//   - logicalKey 前缀 `bgm:`
//   - 落地 `audio/bgm/<slug>.<ext>`
//   - 默认 timeout 拉到 10 分钟(Suno 比图像慢)
//   - inputs 有三个 role:title / prompt / version

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';

export interface GenerateBgmTrackParams {
  readonly trackName: string;
  readonly styleDescription: string;
  readonly version?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateBgmTrackResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

const DEFAULT_BGM_TIMEOUT_MS = 10 * 60 * 1000;

export function logicalKeyForBgm(trackName: string): string {
  return `bgm:${slugForFilename(trackName)}`;
}

export async function generateBgmTrack(
  params: GenerateBgmTrackParams,
): Promise<GenerateBgmTrackResult> {
  const slug = slugForFilename(params.trackName);
  const logicalKey = logicalKeyForBgm(params.trackName);
  const inputs: AiAppNodeInput[] = [
    { role: 'title', value: params.trackName },
    { role: 'prompt', value: params.styleDescription },
  ];
  if (params.version !== undefined) {
    inputs.push({ role: 'version', value: params.version });
  }

  try {
    const task = await runImageTask({
      appKey: 'BGM_TRACK',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      timeoutMs: params.timeoutMs ?? DEFAULT_BGM_TIMEOUT_MS,
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const targetRelativePath = `audio/bgm/${slug}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'bgm_track',
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
      assetType: 'bgm_track',
      errorMessage: msg,
    });
    throw err;
  }
}
