// Visual stage:在 Storyboarder 之后、Coder 之前,给每位角色生成立绘主图,
// 给每个场景生成背景图。失败单条降级成 Stage A Solid() 占位,不阻塞后续。
//
// 和 audio-ui 类似,registry-writing 批次(角色 + 场景)串行跑,避免并发写同一
// asset-registry.json 冲突。角色和场景之间串行即可,没有跨批次依赖。
//
// 产物去向:
//   - 立绘: images/char/<slug>.<ext>,logicalKey = character:<slug>:main
//   - 背景: images/scene/<slug>.<ext>,logicalKey = scene:<slug>:bg
// Coder 在渲染时按 logicalKey 查 registry,ready 则 emit 真路径,否则保留 Solid。

import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import type { FetchLike } from '../assets/download.js';
import type { PlannerOutput } from './types.js';
import { generateCharacterMainImage } from '../executers/character-designer/generate-main-image.js';
import { generateSceneBackground } from '../executers/scene-designer/generate-background.js';

export interface VisualStageStats {
  readonly character: { readonly ok: number; readonly err: number };
  readonly scene: { readonly ok: number; readonly err: number };
}

export interface VisualStageOutput {
  readonly stats: VisualStageStats;
}

export interface VisualStageLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface RunVisualStageParams {
  readonly planner: PlannerOutput;
  readonly gameDir: string;
  readonly registryPath: string;
  readonly runningHubClient: RunningHubClient;
  readonly logger?: VisualStageLogger;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly fetchFn?: FetchLike;
}

const silentLogger: VisualStageLogger = { info: () => {}, error: () => {} };

export async function runVisualStage(
  params: RunVisualStageParams,
): Promise<VisualStageOutput> {
  const log = params.logger ?? silentLogger;
  log.info(
    `[visual] plan: characters=${params.planner.characters.length} scenes=${params.planner.scenes.length}`,
  );

  const character = await runCharacterBatch(params, log);
  const scene = await runSceneBatch(params, log);

  const stats: VisualStageStats = { character, scene };
  log.info(
    `[visual] done: character ${stats.character.ok}/${stats.character.ok + stats.character.err} ` +
      `scene ${stats.scene.ok}/${stats.scene.ok + stats.scene.err}`,
  );
  return { stats };
}

async function runCharacterBatch(
  params: RunVisualStageParams,
  log: VisualStageLogger,
): Promise<{ ok: number; err: number }> {
  let ok = 0;
  let err = 0;
  for (const c of params.planner.characters) {
    try {
      await generateCharacterMainImage({
        characterName: c.name,
        visualDescription: c.visualDescription,
        gameDir: params.gameDir,
        registryPath: params.registryPath,
        client: params.runningHubClient,
        ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
        ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
        ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
      });
      ok++;
    } catch (e) {
      err++;
      log.error(`[visual] character "${c.name}" failed: ${asMessage(e)}`);
    }
  }
  return { ok, err };
}

async function runSceneBatch(
  params: RunVisualStageParams,
  log: VisualStageLogger,
): Promise<{ ok: number; err: number }> {
  let ok = 0;
  let err = 0;
  for (const s of params.planner.scenes) {
    try {
      await generateSceneBackground({
        sceneName: s.name,
        description: s.description,
        gameDir: params.gameDir,
        registryPath: params.registryPath,
        client: params.runningHubClient,
        ...(params.pollIntervalMs !== undefined ? { pollIntervalMs: params.pollIntervalMs } : {}),
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
        ...(params.sleep !== undefined ? { sleep: params.sleep } : {}),
        ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
      });
      ok++;
    } catch (e) {
      err++;
      log.error(`[visual] scene "${s.name}" failed: ${asMessage(e)}`);
    }
  }
  return { ok, err };
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
