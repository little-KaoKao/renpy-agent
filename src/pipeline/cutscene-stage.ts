// Cutscene stage:自动把 storyboarder 产出的 `shot.cutscene` 路由到
// `generateCutsceneVideo`。
//
// 策略(v0.5 末尾新增,故意保守):
//   1. 扫 storyboarder.shots,挑 `cutscene != null` 的 shot;
//   2. 对每个 cutscene,解析首帧 URI:
//      - 先按 `cutscene.referenceSceneName` 到 registry 查已 ready 的 `scene_background`;
//      - 找不到就按 `cutscene.referenceCharacterName` 查 `character_main`;
//      - 再找不到:`kind='transition'` 合法跳过(Coder 黑幕占位也能跑),
//        `kind='reference'` 记为跳过 + 一条 reason,后续手工补。
//   3. 调 `generateCutsceneVideo`,失败走 `markAssetError` 不中断;
//   4. 单条失败不整体失败(和 audio-ui stage 一个风格)。
//
// 为什么是单独一个 stage:audio-ui stage 已经把 BGM/Voice/SFX/UI 塞满,cutscene
// 需要在"已有 scene_background ready"之后跑,时序依赖独立,拆出来更清晰。
// 时序建议:Coder 前跑 audio-ui(可选),再跑 cutscene(可选),最后 Coder 读 registry。
//
// 多图合成首帧(kind='reference' + 场景 + 角色)在 v0.5 范围外 —— 真要做得先调
// `CHARACTER_EXPRESSION` 把两张图合成一张,再喂 Seedance。留给 v0.6。

import { findByLogicalKey, loadRegistry } from '../assets/registry.js';
import {
  logicalKeyForCharacter,
  logicalKeyForScene,
} from '../assets/logical-key.js';
import type { FetchLike } from '../assets/download.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import { generateCutsceneVideo } from '../executers/storyboarder/generate-cutscene.js';
import type { StoryboarderOutput } from './types.js';

export interface CutsceneStageStats {
  readonly ok: number;
  readonly err: number;
  readonly skipped: number;
}

export interface CutsceneStageSkipped {
  readonly shotNumber: number;
  readonly reason: string;
}

export interface CutsceneStageOutput {
  readonly stats: CutsceneStageStats;
  readonly skipped: ReadonlyArray<CutsceneStageSkipped>;
}

export interface CutsceneStageLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface RunCutsceneStageParams {
  readonly storyboarder: StoryboarderOutput;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly runningHubClient: RunningHubClient;
  readonly logger?: CutsceneStageLogger;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly fetchFn?: FetchLike;
}

const silentLogger: CutsceneStageLogger = { info: () => {}, error: () => {} };

export async function runCutsceneStage(
  params: RunCutsceneStageParams,
): Promise<CutsceneStageOutput> {
  const log = params.logger ?? silentLogger;
  const shotsWithCutscene = params.storyboarder.shots.filter((s) => s.cutscene);

  if (shotsWithCutscene.length === 0) {
    log.info('[cutscene] no cutscene shots in storyboard, skipping stage.');
    return { stats: { ok: 0, err: 0, skipped: 0 }, skipped: [] };
  }
  log.info(`[cutscene] ${shotsWithCutscene.length} shot(s) to generate.`);

  // Registry is read once up front — we only need the snapshot to resolve
  // reference first-frame URIs. Each generateCutsceneVideo call writes its own
  // cutscene entry through swapAssetPlaceholder, which re-reads the registry
  // internally, so there's no stale-read race.
  const registry = await loadRegistry(params.registryPath);

  let ok = 0;
  let err = 0;
  const skipped: CutsceneStageSkipped[] = [];

  for (const shot of shotsWithCutscene) {
    const cutscene = shot.cutscene!;
    const firstFrame = resolveFirstFrame(registry, cutscene);

    if (!firstFrame) {
      if (cutscene.kind === 'reference') {
        const reason =
          `kind='reference' but no ready scene/character asset in registry ` +
          `(referenceSceneName="${cutscene.referenceSceneName ?? ''}", ` +
          `referenceCharacterName="${cutscene.referenceCharacterName ?? ''}")`;
        log.error(`[cutscene] shot ${shot.shotNumber} skipped: ${reason}`);
        skipped.push({ shotNumber: shot.shotNumber, reason });
        continue;
      }
      // kind='transition' without a first-frame: let it skip gracefully. Coder
      // will emit a `scene bg_black with fade` + caption placeholder, which is
      // still a legal Stage A endpoint.
      const reason = 'transition without a ready reference scene, leaving Coder placeholder';
      log.info(`[cutscene] shot ${shot.shotNumber} skipped: ${reason}`);
      skipped.push({ shotNumber: shot.shotNumber, reason });
      continue;
    }

    try {
      await generateCutsceneVideo({
        shotNumber: shot.shotNumber,
        kind: cutscene.kind,
        motionPrompt: cutscene.motionPrompt,
        referenceImageUri: firstFrame,
        gameDir: params.gameDir,
        registryPath: params.registryPath,
        client: params.runningHubClient,
        ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
        ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
        ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
      });
      ok++;
      log.info(`[cutscene] shot ${shot.shotNumber} ok (${cutscene.kind}).`);
    } catch (e) {
      err++;
      log.error(
        `[cutscene] shot ${shot.shotNumber} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  log.info(
    `[cutscene] done: ok=${ok} err=${err} skipped=${skipped.length}` +
      ` (of ${shotsWithCutscene.length}).`,
  );
  return { stats: { ok, err, skipped: skipped.length }, skipped };
}

/**
 * Pick a first-frame URL for Seedance2.0 from the registry.
 *
 * Priority: scene background → character main image. We only accept `ready`
 * entries with a `realAssetLocalPath` (converted to a POSIX-style game-relative
 * path; Seedance accepts http URLs or game-local paths that the downstream
 * RunningHub client can resolve, and for this stage we just hand through the
 * local path — the same convention swapAssetPlaceholder stored earlier).
 */
function resolveFirstFrame(
  registry: Awaited<ReturnType<typeof loadRegistry>>,
  cutscene: NonNullable<StoryboarderOutput['shots'][number]['cutscene']>,
): string | undefined {
  if (cutscene.referenceSceneName) {
    const key = logicalKeyForScene(cutscene.referenceSceneName);
    const entry = findByLogicalKey(registry, key);
    if (
      entry &&
      entry.status === 'ready' &&
      entry.assetType === 'scene_background' &&
      (entry.remoteAssetUri || entry.realAssetLocalPath)
    ) {
      // Prefer the original remote URL (Seedance accepts http URLs directly).
      return entry.remoteAssetUri ?? entry.realAssetLocalPath;
    }
  }
  if (cutscene.referenceCharacterName) {
    const key = logicalKeyForCharacter(cutscene.referenceCharacterName);
    const entry = findByLogicalKey(registry, key);
    if (
      entry &&
      entry.status === 'ready' &&
      entry.assetType === 'character_main' &&
      (entry.remoteAssetUri || entry.realAssetLocalPath)
    ) {
      return entry.remoteAssetUri ?? entry.realAssetLocalPath;
    }
  }
  return undefined;
}
