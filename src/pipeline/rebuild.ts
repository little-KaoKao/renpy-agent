// Rebuild:从 workspace snapshot 出发,只跑 Coder + QA,跳过 LLM 三阶段和 AudioUiStage。
//
// 场景:modify 改了 workspace JSON(角色外观 / 对白 / 镜头顺序),需要把改动
// 反映到 script.rpy。也可以手动 `renpy-agent rebuild <story>` 独立使用。

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRegistry, registryPathForGame } from '../assets/registry.js';
import { validateUiPatch } from '../executers/ui-designer/generate-ui-patch.js';
import type { UiDesign } from '../schema/galgame-workspace.js';
import {
  listWorkspaceCollection,
  readWorkspaceDoc,
} from '../agents/workspace-io.js';
import { writeGameProject } from './coder.js';
import { runQa } from './qa.js';
import {
  loadStoryWorkspace,
  workspacePathsForGame,
  type StoryWorkspaceSnapshot,
  type UiSnapshot,
} from './workspace.js';
import type {
  PlannerOutput,
  PlannerOutputCharacter,
  StoryboarderOutput,
  TestRunResult,
  WriterOutput,
} from './types.js';

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

  const snapshot = await loadWorkspaceSnapshotForRebuild(gameDir);
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
 * v0.7: prefer the V5 per-URI layout, fall back to v0.2 aggregate JSON.
 * This lets `rebuild` handle both legacy v0.4 projects (aggregate only) and
 * new V5 projects (per-URI canonical, aggregate mirrored by the pipeline).
 */
async function loadWorkspaceSnapshotForRebuild(
  gameDir: string,
): Promise<StoryWorkspaceSnapshot> {
  const perUri = await tryLoadFromPerUri(gameDir);
  if (perUri) return perUri;
  return await loadStoryWorkspace(gameDir);
}

async function tryLoadFromPerUri(
  gameDir: string,
): Promise<StoryWorkspaceSnapshot | undefined> {
  const project = await readWorkspaceDoc<{
    title?: string;
    genre?: string;
    tone?: string;
  }>('workspace://project', gameDir);
  const chapter = await readWorkspaceDoc<{ outline?: string }>('workspace://chapter', gameDir);
  const writer = await readWorkspaceDoc<WriterOutput>('workspace://script', gameDir);
  const storyboarder = await readWorkspaceDoc<StoryboarderOutput>(
    'workspace://storyboard',
    gameDir,
  );
  if (!project || !chapter || !writer || !storyboarder) return undefined;

  const characters: PlannerOutputCharacter[] = [];
  for (const e of await listWorkspaceCollection('character', gameDir)) {
    const doc = await readWorkspaceDoc<{
      name: string;
      description: string;
      visualDescription: string;
    }>(e.uri, gameDir);
    if (doc) {
      characters.push({
        name: doc.name,
        description: doc.description,
        visualDescription: doc.visualDescription,
      });
    }
  }
  const scenes: Array<{ name: string; description: string }> = [];
  for (const e of await listWorkspaceCollection('scene', gameDir)) {
    const doc = await readWorkspaceDoc<{ name: string; description: string }>(
      e.uri,
      gameDir,
    );
    if (doc) scenes.push({ name: doc.name, description: doc.description });
  }

  const planner: PlannerOutput = {
    projectTitle: project.title ?? '',
    genre: project.genre ?? '',
    tone: project.tone ?? '',
    characters,
    scenes,
    chapterOutline: chapter.outline ?? '',
  };
  return { planner, writer, storyboarder };
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
