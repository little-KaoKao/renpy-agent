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
//       bgm.json             (v0.5+,仅当 audio/ui stage 跑了才有)
//       voice.json           (v0.5+)
//       sfx.json             (v0.5+)
//       ui.json              (v0.5+)
//
// 为什么单独放 `workspace/`:和 `game/` 平级、和 `asset-registry.json` 兄弟位,都不
// 进 Ren'Py 打包扫描;JSON 文件开发期肉眼可读,修改场景出问题时可以直接看 diff。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { slugForFilename } from '../assets/download.js';
import { writeWorkspaceDoc } from '../agents/workspace-io.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';

export const WORKSPACE_DIRNAME = 'workspace';
export const PLANNER_FILENAME = 'planner.json';
export const WRITER_FILENAME = 'writer.json';
export const STORYBOARDER_FILENAME = 'storyboarder.json';
export const BGM_FILENAME = 'bgm.json';
export const VOICE_FILENAME = 'voice.json';
export const SFX_FILENAME = 'sfx.json';
export const UI_FILENAME = 'ui.json';

export interface StoryWorkspacePaths {
  readonly workspaceDir: string;
  readonly plannerPath: string;
  readonly writerPath: string;
  readonly storyboarderPath: string;
  readonly bgmPath: string;
  readonly voicePath: string;
  readonly sfxPath: string;
  readonly uiPath: string;
}

/** 传入 `<gameRoot>/game`,算出 workspace 子目录和全部 JSON 的绝对路径。 */
export function workspacePathsForGame(gameDir: string): StoryWorkspacePaths {
  const workspaceDir = resolve(dirname(gameDir), WORKSPACE_DIRNAME);
  return {
    workspaceDir,
    plannerPath: resolve(workspaceDir, PLANNER_FILENAME),
    writerPath: resolve(workspaceDir, WRITER_FILENAME),
    storyboarderPath: resolve(workspaceDir, STORYBOARDER_FILENAME),
    bgmPath: resolve(workspaceDir, BGM_FILENAME),
    voicePath: resolve(workspaceDir, VOICE_FILENAME),
    sfxPath: resolve(workspaceDir, SFX_FILENAME),
    uiPath: resolve(workspaceDir, UI_FILENAME),
  };
}

export interface BgmSnapshotEntry {
  readonly sceneName: string;
  readonly trackName: string;
  readonly styleDescription: string;
}

export interface VoiceSnapshotEntry {
  readonly shotNumber: number;
  readonly lineIndex: number;
  readonly speaker: string;
  readonly text: string;
  readonly voiceTag: string;
}

export interface SfxSnapshotEntry {
  readonly shotNumber: number;
  readonly cue: 'enter' | 'action' | 'exit' | 'ambient';
  readonly description: string;
}

export interface UiSnapshotEntry {
  readonly screen: string;
  readonly moodTag: string;
  readonly rpyScreenPatch: string;
}

export interface BgmSnapshot {
  readonly tracks: ReadonlyArray<BgmSnapshotEntry>;
}

export interface VoiceSnapshot {
  readonly lines: ReadonlyArray<VoiceSnapshotEntry>;
}

export interface SfxSnapshot {
  readonly cues: ReadonlyArray<SfxSnapshotEntry>;
}

export interface UiSnapshot {
  readonly patches: ReadonlyArray<UiSnapshotEntry>;
}

export interface StoryWorkspaceSnapshot {
  readonly planner: PlannerOutput;
  readonly writer: WriterOutput;
  readonly storyboarder: StoryboarderOutput;
}

export interface AudioUiWorkspaceSnapshot {
  readonly bgm?: BgmSnapshot;
  readonly voice?: VoiceSnapshot;
  readonly sfx?: SfxSnapshot;
  readonly ui?: UiSnapshot;
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

// ---------------------------------------------------------------------------
// v0.7: per-URI projection of the same snapshot
// ---------------------------------------------------------------------------
//
// v0.2 pipeline wrote three aggregate JSONs; V5 reads/writes per-URI docs. The
// two used to drift: a v0.2-generated project couldn't be `modify`-ed through
// the V5 tool chain because the per-URI layout was missing, and vice versa.
//
// saveStoryWorkspacePerUri() produces the V5 layout **from the same snapshot**
// that saveStoryWorkspace() just wrote. Aggregate JSON stays as a `--resume`
// fast-path + v0.2 legacy compat; per-URI is the canonical source from v0.8.

export interface StoryWorkspacePerUriResult {
  readonly projectUri: string;
  readonly chapterUri: string;
  readonly scriptUri: string;
  readonly storyboardUri: string;
  readonly characterUris: ReadonlyArray<string>;
  readonly sceneUris: ReadonlyArray<string>;
}

export async function saveStoryWorkspacePerUri(
  gameDir: string,
  snapshot: StoryWorkspaceSnapshot,
): Promise<StoryWorkspacePerUriResult> {
  const paths = workspacePathsForGame(gameDir);
  await mkdir(paths.workspaceDir, { recursive: true });

  const projectUri = 'workspace://project';
  const chapterUri = 'workspace://chapter';
  const scriptUri = 'workspace://script';
  const storyboardUri = 'workspace://storyboard';

  // Shapes here mirror the V5 executer writers (producer / character-designer
  // / scene-designer / writer / storyboarder tools). Keeping them aligned is
  // what makes `modify` work against both v0.2 and V5 produced projects.
  const projectDoc = {
    title: snapshot.planner.projectTitle,
    genre: snapshot.planner.genre,
    tone: snapshot.planner.tone,
    status: 'ready' as const,
  };
  const chapterDoc = {
    projectUri,
    outline: snapshot.planner.chapterOutline,
    status: 'ready' as const,
  };

  const characterUris: string[] = [];
  for (const c of snapshot.planner.characters) {
    const slug = slugForFilename(c.name);
    const uri = `workspace://character/${slug}`;
    characterUris.push(uri);
    await writeWorkspaceDoc(uri, gameDir, {
      name: c.name,
      description: c.description,
      visualDescription: c.visualDescription,
      mainImageUri: null,
      status: 'placeholder' as const,
    });
  }

  const sceneUris: string[] = [];
  for (const s of snapshot.planner.scenes) {
    const slug = slugForFilename(s.name);
    const uri = `workspace://scene/${slug}`;
    sceneUris.push(uri);
    await writeWorkspaceDoc(uri, gameDir, {
      name: s.name,
      description: s.description,
      backgroundUri: null,
      status: 'placeholder' as const,
    });
  }

  await writeWorkspaceDoc(projectUri, gameDir, projectDoc);
  await writeWorkspaceDoc(chapterUri, gameDir, chapterDoc);
  await writeWorkspaceDoc(scriptUri, gameDir, snapshot.writer);
  await writeWorkspaceDoc(storyboardUri, gameDir, snapshot.storyboarder);

  return {
    projectUri,
    chapterUri,
    scriptUri,
    storyboardUri,
    characterUris,
    sceneUris,
  };
}

/** Save a single stage output — lets pipeline persist incrementally instead of waiting for all three. */
export async function savePlannerSnapshot(gameDir: string, planner: PlannerOutput): Promise<string> {
  const paths = workspacePathsForGame(gameDir);
  await mkdir(paths.workspaceDir, { recursive: true });
  await writeJson(paths.plannerPath, planner);
  return paths.plannerPath;
}

export async function saveWriterSnapshot(gameDir: string, writer: WriterOutput): Promise<string> {
  const paths = workspacePathsForGame(gameDir);
  await mkdir(paths.workspaceDir, { recursive: true });
  await writeJson(paths.writerPath, writer);
  return paths.writerPath;
}

export async function saveStoryboarderSnapshot(
  gameDir: string,
  storyboarder: StoryboarderOutput,
): Promise<string> {
  const paths = workspacePathsForGame(gameDir);
  await mkdir(paths.workspaceDir, { recursive: true });
  await writeJson(paths.storyboarderPath, storyboarder);
  return paths.storyboarderPath;
}

/** Load whichever stage snapshots exist. Missing files → undefined, not an error. */
export async function tryLoadStageSnapshots(gameDir: string): Promise<{
  planner?: PlannerOutput;
  writer?: WriterOutput;
  storyboarder?: StoryboarderOutput;
}> {
  const paths = workspacePathsForGame(gameDir);
  const [planner, writer, storyboarder] = await Promise.all([
    tryReadJson<PlannerOutput>(paths.plannerPath),
    tryReadJson<WriterOutput>(paths.writerPath),
    tryReadJson<StoryboarderOutput>(paths.storyboarderPath),
  ]);
  const out: { planner?: PlannerOutput; writer?: WriterOutput; storyboarder?: StoryboarderOutput } = {};
  if (planner) out.planner = planner;
  if (writer) out.writer = writer;
  if (storyboarder) out.storyboarder = storyboarder;
  return out;
}

async function tryReadJson<T>(path: string): Promise<T | undefined> {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
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

/**
 * Write optional audio/UI snapshots. Missing keys are skipped so a partial
 * pipeline run (e.g. only BGM succeeded) still leaves a diffable record.
 */
export async function saveAudioUiWorkspace(
  gameDir: string,
  snapshot: AudioUiWorkspaceSnapshot,
): Promise<StoryWorkspacePaths> {
  const paths = workspacePathsForGame(gameDir);
  await mkdir(paths.workspaceDir, { recursive: true });
  const writes: Promise<void>[] = [];
  if (snapshot.bgm) writes.push(writeJson(paths.bgmPath, snapshot.bgm));
  if (snapshot.voice) writes.push(writeJson(paths.voicePath, snapshot.voice));
  if (snapshot.sfx) writes.push(writeJson(paths.sfxPath, snapshot.sfx));
  if (snapshot.ui) writes.push(writeJson(paths.uiPath, snapshot.ui));
  await Promise.all(writes);
  return paths;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as T;
}
