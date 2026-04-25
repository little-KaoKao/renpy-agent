// 音效设计师:单条 SFX 生成入口。
//
// 后端:暂复用 Qwen3 TTS 声音设计(`SFX` 走 webappId 2014603342701404161,
// 与 VOICE_LINE 同 webappId)。"音效描述"塞 `line_text`,"朗读者"塞 `voice_text`
// 的默认 'ambient sound field, no voice, pure environmental audio'。
//
// TODO: 复用 TTS 的音质很差,后续换独立 TTA(text-to-audio)模型 ——
// 对应 Plan 1 §3.4 / Plan 2 §3.3 的已知妥协。
//
// Ren'Py 端:Coder 在 Shot 头按 cue=enter 插 `play sound`,在 Shot 尾按 cue=exit 插。
// ambient / action cue v0.5 不处理(见 Plan 2 §4.3)。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';

export type SfxCue = 'enter' | 'action' | 'exit' | 'ambient';

export interface GenerateSfxParams {
  readonly shotNumber: number;
  readonly cue: SfxCue;
  readonly description: string;
  readonly voiceHint?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateSfxResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

const DEFAULT_SFX_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_VOICE_HINT =
  'ambient sound field, no voice, pure environmental audio';

export function logicalKeyForSfx(shotNumber: number, cue: SfxCue): string {
  return `sfx:shot_${shotNumber}:${cue}`;
}

export async function generateSfx(
  params: GenerateSfxParams,
): Promise<GenerateSfxResult> {
  const logicalKey = logicalKeyForSfx(params.shotNumber, params.cue);
  const inputs: AiAppNodeInput[] = [
    { role: 'voice_text', value: params.voiceHint ?? DEFAULT_VOICE_HINT },
    { role: 'line_text', value: params.description },
  ];

  try {
    const task = await runImageTask({
      appKey: 'SFX',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      timeoutMs: params.timeoutMs ?? DEFAULT_SFX_TIMEOUT_MS,
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const targetRelativePath = `audio/sfx/shot_${params.shotNumber}_${params.cue}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'sfx',
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
      assetType: 'sfx',
      errorMessage: msg,
    });
    throw err;
  }
}
