// Story workspace:把 planner / writer / storyboarder 的中间 JSON 落盘,让
// v0.4 的"改某处 → 重渲染"能真正吃到上一次的状态,而不是必须从 CLI 再跑一遍 LLM。
//
// 布局(每游戏一份):
//   runtime/games/<story>/
//     game/                 <- Ren'Py 产出(script.rpy 等)
//     asset-registry.json   <- v0.3b AssetRegistry
//     workspace/
//       planner.json
//       writer.json
//       storyboarder.json
//
// 为什么单独放 `workspace/`:和 `game/` 平级、和 `asset-registry.json` 兄弟位,都不
// 进 Ren'Py 打包扫描;JSON 文件开发期肉眼可读,修改场景出问题时可以直接看 diff。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';

export const WORKSPACE_DIRNAME = 'workspace';
export const PLANNER_FILENAME = 'planner.json';
export const WRITER_FILENAME = 'writer.json';
export const STORYBOARDER_FILENAME = 'storyboarder.json';

export interface StoryWorkspacePaths {
  readonly workspaceDir: string;
  readonly plannerPath: string;
  readonly writerPath: string;
  readonly storyboarderPath: string;
}

/** 传入 `<gameRoot>/game`,算出 workspace 子目录及三个 JSON 的绝对路径。 */
export function workspacePathsForGame(gameDir: string): StoryWorkspacePaths {
  const workspaceDir = resolve(dirname(gameDir), WORKSPACE_DIRNAME);
  return {
    workspaceDir,
    plannerPath: resolve(workspaceDir, PLANNER_FILENAME),
    writerPath: resolve(workspaceDir, WRITER_FILENAME),
    storyboarderPath: resolve(workspaceDir, STORYBOARDER_FILENAME),
  };
}

export interface StoryWorkspaceSnapshot {
  readonly planner: PlannerOutput;
  readonly writer: WriterOutput;
  readonly storyboarder: StoryboarderOutput;
}

export async function saveStoryWorkspace(
  gameDir: string,
  snapshot: StoryWorkspaceSnapshot,
): Promise<StoryWorkspacePaths> {
  const paths = workspacePathsForGame(gameDir);
  await mkdir(paths.workspaceDir, { recursive: true });
  await Promise.all([
    writeJson(paths.plannerPath, snapshot.planner),
    writeJson(paths.writerPath, snapshot.writer),
    writeJson(paths.storyboarderPath, snapshot.storyboarder),
  ]);
  return paths;
}

export async function loadStoryWorkspace(gameDir: string): Promise<StoryWorkspaceSnapshot> {
  const paths = workspacePathsForGame(gameDir);
  const [planner, writer, storyboarder] = await Promise.all([
    readJson<PlannerOutput>(paths.plannerPath),
    readJson<WriterOutput>(paths.writerPath),
    readJson<StoryboarderOutput>(paths.storyboarderPath),
  ]);
  return { planner, writer, storyboarder };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as T;
}
