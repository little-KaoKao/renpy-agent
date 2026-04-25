// Rebuild:从 workspace snapshot 出发,只跑 Coder + QA,跳过 LLM 三阶段和 AudioUiStage。
//
// 场景:modify 改了 workspace JSON(角色外观 / 对白 / 镜头顺序),需要把改动
// 反映到 script.rpy。也可以手动 `renpy-agent rebuild <story>` 独立使用。

import { resolve } from 'node:path';
import { loadRegistry, registryPathForGame } from '../assets/registry.js';
import { writeGameProject } from './coder.js';
import { runQa } from './qa.js';
import { loadStoryWorkspace } from './workspace.js';
import type { TestRunResult } from './types.js';

export interface RebuildOptions {
  readonly storyName: string;
  /** Defaults to `<cwd>/runtime`. */
  readonly runtimeRoot?: string;
  /** Forwarded to `runQa` as `repoRoot`; defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  /** Forwarded to `runQa` as `sdkPath`. */
  readonly sdkPath?: string;
}

export interface RebuildResult {
  readonly gamePath: string;
  readonly testRun: TestRunResult;
}

export async function rebuildGameProject(opts: RebuildOptions): Promise<RebuildResult> {
  const runtimeRoot = opts.runtimeRoot ?? resolve(process.cwd(), 'runtime');
  const gameDir = resolve(runtimeRoot, 'games', opts.storyName, 'game');

  const snapshot = await loadStoryWorkspace(gameDir);
  const registry = await loadRegistry(registryPathForGame(gameDir));

  await writeGameProject({
    planner: snapshot.planner,
    storyboarder: snapshot.storyboarder,
    gameDir,
    assetRegistry: registry,
  });

  const testRun = await runQa({
    gamePath: gameDir,
    ...(opts.repoRoot !== undefined ? { repoRoot: opts.repoRoot } : {}),
    ...(opts.sdkPath !== undefined ? { sdkPath: opts.sdkPath } : {}),
  });

  return { gamePath: gameDir, testRun };
}
