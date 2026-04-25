// 配音导演:单句对白配音入口。
//
// 后端:Qwen3 TTS 声音设计(`VOICE_LINE` 走 webappId 2014603342701404161)。
// schema 在 nodeId=7/select=1 + nodeId=6/select=1 两条固定 option 之上,吃两条
// 自由文本:`voice_text`(音色描述 / Character.voiceTag)和 `line_text`(台词)。
//
// Ren'Py 端:Coder 在 dialogue 之前插 `voice "audio/voice/scene_<N>/line_<i>.<ext>"`。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';
import { logicalKeyForVoiceLine } from '../../assets/logical-key.js';

export interface GenerateVoiceLineParams {
  readonly sceneNumber: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly voiceTag: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateVoiceLineResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

const DEFAULT_VOICE_TIMEOUT_MS = 3 * 60 * 1000;

export async function generateVoiceLine(
  params: GenerateVoiceLineParams,
): Promise<GenerateVoiceLineResult> {
  const logicalKey = logicalKeyForVoiceLine(params.sceneNumber, params.lineIndex);
  const inputs: AiAppNodeInput[] = [
    { role: 'voice_text', value: params.voiceTag },
    { role: 'line_text', value: params.text },
  ];

  try {
    const task = await runImageTask({
      appKey: 'VOICE_LINE',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      timeoutMs: params.timeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS,
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const targetRelativePath =
      `audio/voice/scene_${params.sceneNumber}/line_${params.lineIndex}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'voice_line',
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
      assetType: 'voice_line',
      errorMessage: msg,
    });
    throw err;
  }
}
