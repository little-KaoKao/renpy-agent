// Rebuild:从 workspace snapshot 出发,只跑 Coder + QA,跳过 LLM 三阶段和 AudioUiStage。
//
// 场景:modify 改了 workspace JSON(角色外观 / 对白 / 镜头顺序),需要把改动
// 反映到 script.rpy。也可以手动 `renpy-agent rebuild <story>` 独立使用。

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRegistry, registryPathForGame } from '../assets/registry.js';
import { validateUiPatch } from '../executers/ui-designer/generate-ui-patch.js';
import type { UiDesign } from '../schema/galgame-workspace.js';
import { writeGameProject } from './coder.js';
import { runQa } from './qa.js';
import {
  loadStoryWorkspace,
  workspacePathsForGame,
  type UiSnapshot,
} from './workspace.js';
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
  const uiPatches = await loadValidatedUiPatches(gameDir);

  await writeGameProject({
    planner: snapshot.planner,
    storyboarder: snapshot.storyboarder,
    gameDir,
    assetRegistry: registry,
    ...(uiPatches.length > 0 ? { uiPatches } : {}),
  });

  const testRun = await runQa({
    gamePath: gameDir,
    ...(opts.repoRoot !== undefined ? { repoRoot: opts.repoRoot } : {}),
    ...(opts.sdkPath !== undefined ? { sdkPath: opts.sdkPath } : {}),
  });

  return { gamePath: gameDir, testRun };
}

/**
 * Load `workspace/ui.json` if present and only return patches that pass the
 * validator. A legacy snapshot with a forbidden property (e.g. a font
 * override that would crash at runtime) is silently dropped — Ren'Py falls
 * back to the default template screen for that slot, which is always safe.
 */
async function loadValidatedUiPatches(
  gameDir: string,
): Promise<ReadonlyArray<{ readonly screen: string; readonly patch: string }>> {
  const paths = workspacePathsForGame(gameDir);
  let ui: UiSnapshot;
  try {
    const text = await readFile(paths.uiPath, 'utf8');
    ui = JSON.parse(text) as UiSnapshot;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: Array<{ screen: string; patch: string }> = [];
  for (const entry of ui.patches) {
    try {
      validateUiPatch(entry.rpyScreenPatch, entry.screen as UiDesign['screen']);
      out.push({ screen: entry.screen, patch: entry.rpyScreenPatch });
    } catch {
      // Skip invalid patches silently — regenerate by rerunning audio-ui.
    }
  }
  return out;
}
