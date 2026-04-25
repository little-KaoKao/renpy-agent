// 角色设计师:表情差分生成入口。
//
// 后端:Nanobanana2 图生图(`CHARACTER_EXPRESSION` 走 webappId 2027211316242423809)。
// schema 里吃 1~3 张参考图(`reference_image_1` 必传、`reference_image_2/3` optional)+
// 文本 prompt(描述目标表情)。
//
// 调用者典型姿态:先跑 generateCharacterMainImage 拿到主图 URL,再传 referenceImages=[主图]
// 和一条"smiling, open mouth, same outfit"这样的 prompt。需要多图参考(例如要保持服装
// 一致 + 姿势参考)就再塞 2~3 张。
//
// logicalKey 独立(`character:<slug>:expr:<expr>`),与主图解耦 —— 主图换了,
// 表情差分可以单独再生;表情差分换了,主图无感。

import type {
  AiAppNodeInput,
  RunningHubClient,
} from '../common/runninghub-client.js';
import { runImageTask } from '../common/run-image-task.js';
import { inferExtensionFromUrl, slugForFilename } from '../../assets/download.js';
import type { FetchLike } from '../../assets/download.js';
import { swapAssetPlaceholder, markAssetError } from '../../assets/swap.js';
import type { AssetRegistryEntry } from '../../assets/registry.js';
import { logicalKeyForCharacterExpression } from '../../assets/logical-key.js';

export interface GenerateCharacterExpressionParams {
  readonly characterName: string;
  readonly expressionName: string;
  /** 1~3 张参考图 URL;第一张是基准(角色主图),后续两张可选用于补充(服装 / 姿势)。 */
  readonly referenceImages: ReadonlyArray<string>;
  readonly expressionPrompt: string;
  readonly styleHint?: string;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly client: RunningHubClient;
  readonly fetchFn?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GenerateCharacterExpressionResult {
  readonly entry: AssetRegistryEntry;
  readonly remoteUrl: string;
  readonly byteLength: number;
}

export function buildCharacterExpressionPrompt(
  expressionPrompt: string,
  styleHint?: string,
): string {
  const style =
    styleHint ??
    'same character, same outfit and hairstyle, neutral pose, clean background, portrait sheet';
  return `${expressionPrompt.trim()}. ${style}.`;
}

export async function generateCharacterExpression(
  params: GenerateCharacterExpressionParams,
): Promise<GenerateCharacterExpressionResult> {
  if (params.referenceImages.length === 0) {
    throw new Error(
      'generateCharacterExpression: referenceImages must contain at least one image URL',
    );
  }
  if (params.referenceImages.length > 3) {
    throw new Error(
      `generateCharacterExpression: Nanobanana2 accepts at most 3 reference images (got ${params.referenceImages.length})`,
    );
  }

  const logicalKey = logicalKeyForCharacterExpression(
    params.characterName,
    params.expressionName,
  );
  const prompt = buildCharacterExpressionPrompt(params.expressionPrompt, params.styleHint);

  const roles: ReadonlyArray<'reference_image_1' | 'reference_image_2' | 'reference_image_3'> = [
    'reference_image_1',
    'reference_image_2',
    'reference_image_3',
  ];
  const inputs: AiAppNodeInput[] = [{ role: 'prompt', value: prompt }];
  params.referenceImages.forEach((url, i) => {
    inputs.push({ role: roles[i]!, value: url });
  });

  try {
    const task = await runImageTask({
      appKey: 'CHARACTER_EXPRESSION',
      inputs,
      client: params.client,
      ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
    });

    const ext = inferExtensionFromUrl(task.outputUri);
    const charSlug = slugForFilename(params.characterName);
    const exprSlug = slugForFilename(params.expressionName);
    const targetRelativePath = `images/char/${charSlug}__${exprSlug}${ext}`;
    const swap = await swapAssetPlaceholder({
      gameDir: params.gameDir,
      registryPath: params.registryPath,
      logicalKey,
      assetType: 'character_expression',
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
      assetType: 'character_expression',
      errorMessage: msg,
    });
    throw err;
  }
}
