// v0.4 修改闭环:三个典型场景的确定性 helper。
//
// 设计原则(紧贴 PLAN §2.1 + §8):
//  - 不走 LLM:这三种操作是结构化改字段,让 LLM 来反而更不稳定;留 planner/writer 给
//    "改灵感重走全流程"使用。
//  - 只改需要改的那一级文档(planner 或 storyboarder),其他文档**不动**。URI
//    依赖链保证下游自动生效。
//  - AssetRegistry:改角色外观 → 把该角色的 character_main 条目转回 `placeholder`
//    (真资产不能继续用,但占位 bg_X 渲染立即恢复可跑);改对白 / 重排镜头不动 registry。
//
// v0.7 workspace-unification:
//  - Per-URI(V5)是**主**,aggregate JSON(v0.2)是兼容层。
//  - 读取优先 per-URI;找不到才回落 aggregate(老 v0.4 产物兼容)。
//  - 写入双写:per-URI 每次都写;aggregate 只在原本存在时更新,保持和 per-URI 一致。
//
// 这些 helper 不负责调 coder / lint;caller(或后续 CLI)串起来。

import { readFile } from 'node:fs/promises';
import {
  loadRegistry,
  saveRegistry,
  upsertEntry,
  findByLogicalKey,
  registryPathForGame,
  type AssetRegistryEntry,
  type AssetRegistryFile,
} from '../assets/registry.js';
import { slugForFilename } from '../assets/download.js';
import { logicalKeyForCharacter } from '../assets/logical-key.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../agents/workspace-io.js';
import type {
  PlannerOutput,
  PlannerOutputCharacter,
  StoryboarderOutput,
  StoryboarderOutputDialogueLine,
  StoryboarderOutputShot,
  WriterOutput,
} from './types.js';
import {
  saveStoryWorkspace,
  workspacePathsForGame,
  type StoryWorkspaceSnapshot,
} from './workspace.js';

// Per-URI character document shape (same as the V5 character-designer tool
// writes). Only `name` / `description` / `visualDescription` are exercised by
// modify; the other fields are preserved as-is so we don't clobber state set
// by the image-gen task agents.
interface CharacterDocFile {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
  readonly mainImageUri?: string | null;
  readonly status?: 'ready' | 'placeholder';
  readonly [k: string]: unknown;
}

export interface ModifyContext {
  /** `<gameRoot>/game`,和 workspace / asset-registry 同一兄弟位。 */
  readonly gameDir: string;
  /** 允许测试注入时间,默认 `() => new Date()`。 */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// internal: dual-layout IO
// ---------------------------------------------------------------------------

interface LoadedWorkspace {
  readonly snapshot: StoryWorkspaceSnapshot;
  /** Whether the aggregate planner/writer/storyboarder JSONs existed on disk. */
  readonly hadAggregate: boolean;
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

/**
 * Load both layouts. Aggregate JSON wins for caller-returned snapshots (so the
 * v0.4 contract is preserved when a legacy project is being modified), but
 * missing fields fall back to per-URI (so V5-generated projects work too).
 */
async function loadWorkspaceForModify(gameDir: string): Promise<LoadedWorkspace> {
  const paths = workspacePathsForGame(gameDir);
  const [aggPlanner, aggWriter, aggStoryboarder] = await Promise.all([
    tryReadJson<PlannerOutput>(paths.plannerPath),
    tryReadJson<WriterOutput>(paths.writerPath),
    tryReadJson<StoryboarderOutput>(paths.storyboarderPath),
  ]);
  const hadAggregate = !!(aggPlanner && aggWriter && aggStoryboarder);

  // Per-URI reads are best-effort; used to fill gaps left by the aggregate layer.
  const planner = aggPlanner ?? (await assemblePlannerFromPerUri(gameDir));
  const writer =
    aggWriter ?? (await readWorkspaceDoc<WriterOutput>('workspace://script', gameDir));
  const storyboarder =
    aggStoryboarder ??
    (await readWorkspaceDoc<StoryboarderOutput>('workspace://storyboard', gameDir));

  if (!planner || !writer || !storyboarder) {
    throw new Error(
      `loadWorkspaceForModify: could not reconstruct workspace snapshot at ${gameDir}. ` +
        'Neither aggregate JSON nor per-URI docs are complete.',
    );
  }
  return { snapshot: { planner, writer, storyboarder }, hadAggregate };
}

async function assemblePlannerFromPerUri(gameDir: string): Promise<PlannerOutput | undefined> {
  const project = await readWorkspaceDoc<{
    title?: string;
    genre?: string;
    tone?: string;
  }>('workspace://project', gameDir);
  const chapter = await readWorkspaceDoc<{ outline?: string }>('workspace://chapter', gameDir);
  if (!project || !chapter) return undefined;

  const { listWorkspaceCollection } = await import('../agents/workspace-io.js');
  const characters: PlannerOutputCharacter[] = [];
  for (const e of await listWorkspaceCollection('character', gameDir)) {
    const doc = await readWorkspaceDoc<CharacterDocFile>(e.uri, gameDir);
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
    const doc = await readWorkspaceDoc<{ name: string; description: string }>(e.uri, gameDir);
    if (doc) scenes.push({ name: doc.name, description: doc.description });
  }

  return {
    projectTitle: project.title ?? '',
    genre: project.genre ?? '',
    tone: project.tone ?? '',
    characters,
    scenes,
    chapterOutline: chapter.outline ?? '',
  };
}

/**
 * Resolve a character URI by name. Primary: new slug via `slugForFilename`.
 * Fallback: the v0.6 legacy literal `'asset'` slug that pure-CJK names used
 * to collapse into; only probed when the primary path doesn't exist.
 */
async function resolveCharacterDocUri(
  gameDir: string,
  characterName: string,
): Promise<{ uri: string; doc: CharacterDocFile } | undefined> {
  const primary = `workspace://character/${slugForFilename(characterName)}`;
  const primaryDoc = await readWorkspaceDoc<CharacterDocFile>(primary, gameDir);
  if (primaryDoc) return { uri: primary, doc: primaryDoc };

  // Legacy fallback: pre-hardening, every non-ASCII name collapsed to 'asset'.
  const legacyUri = 'workspace://character/asset';
  const legacyDoc = await readWorkspaceDoc<CharacterDocFile>(legacyUri, gameDir);
  if (legacyDoc && legacyDoc.name === characterName) {
    return { uri: legacyUri, doc: legacyDoc };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 1) 改角色外观(典型场景:"把女主改成短发")
// ---------------------------------------------------------------------------

export interface ModifyCharacterAppearanceParams extends ModifyContext {
  readonly characterName: string;
  readonly newVisualDescription: string;
  readonly newDescription?: string;
  /** registry 路径,默认由 `registryPathForGame(gameDir)` 推。允许测试覆写。 */
  readonly registryPath?: string;
}

export interface ModifyCharacterAppearanceResult {
  readonly snapshot: StoryWorkspaceSnapshot;
  readonly registryChanged: boolean;
  readonly registry?: AssetRegistryFile;
}

/**
 * 改 planner.characters[i] 的 visualDescription(可选连带 description)。
 * 若 AssetRegistry 里已有该角色 `character_main` 的 ready 条目,把它标成
 * `placeholder`,真资产路径保留做历史痕迹,status 回落 → Coder 下轮重渲染会自动
 * 掉回 Solid 占位,直到新立绘 ready。
 */
export async function modifyCharacterAppearance(
  params: ModifyCharacterAppearanceParams,
): Promise<ModifyCharacterAppearanceResult> {
  const now = params.now ?? (() => new Date());
  const { snapshot: prev, hadAggregate } = await loadWorkspaceForModify(params.gameDir);

  const idx = prev.planner.characters.findIndex((c) => c.name === params.characterName);
  if (idx < 0) {
    throw new Error(
      `modifyCharacterAppearance: no character named "${params.characterName}" in planner`,
    );
  }
  const oldChar = prev.planner.characters[idx]!;
  const newChar: PlannerOutputCharacter = {
    name: oldChar.name,
    description: params.newDescription ?? oldChar.description,
    visualDescription: params.newVisualDescription,
  };
  const nextChars = [...prev.planner.characters];
  nextChars[idx] = newChar;
  const nextPlanner: PlannerOutput = { ...prev.planner, characters: nextChars };

  const nextSnapshot: StoryWorkspaceSnapshot = {
    planner: nextPlanner,
    writer: prev.writer,
    storyboarder: prev.storyboarder,
  };

  // Per-URI: update the character doc (preserve image-gen fields). If the
  // per-URI doc is missing (legacy v0.4 project), create one so subsequent
  // `modify` and V5 tools line up.
  const existingPerUri = await resolveCharacterDocUri(params.gameDir, params.characterName);
  const targetUri =
    existingPerUri?.uri ?? `workspace://character/${slugForFilename(params.characterName)}`;
  const nextCharDoc: CharacterDocFile = {
    ...(existingPerUri?.doc ?? {}),
    name: newChar.name,
    description: newChar.description,
    visualDescription: newChar.visualDescription,
  };
  await writeWorkspaceDoc(targetUri, params.gameDir, nextCharDoc);

  // Aggregate: only if it existed on disk pre-modification.
  if (hadAggregate) {
    await saveStoryWorkspace(params.gameDir, nextSnapshot);
  }

  const registryPath = params.registryPath ?? defaultRegistryPath(params.gameDir);
  const registry = await loadRegistry(registryPath);
  const logicalKey = logicalKeyForCharacter(params.characterName);
  const existing = findByLogicalKey(registry, logicalKey);
  if (existing && existing.status === 'ready') {
    const invalidated: AssetRegistryEntry = {
      ...existing,
      status: 'placeholder',
      updatedAt: now().toISOString(),
    };
    const nextRegistry = upsertEntry(registry, invalidated);
    await saveRegistry(registryPath, nextRegistry);
    return { snapshot: nextSnapshot, registryChanged: true, registry: nextRegistry };
  }
  return { snapshot: nextSnapshot, registryChanged: false };
}

// ---------------------------------------------------------------------------
// 2) 改某句对白(典型场景:"把 Shot 3 的第 2 句换掉")
// ---------------------------------------------------------------------------

export interface ModifyDialogueLineParams extends ModifyContext {
  readonly shotNumber: number;
  /** 0-indexed,对齐 dialogueLines 数组。 */
  readonly lineIndex: number;
  readonly newText: string;
  readonly newSpeaker?: string;
}

export async function modifyDialogueLine(
  params: ModifyDialogueLineParams,
): Promise<StoryWorkspaceSnapshot> {
  const { snapshot: prev, hadAggregate } = await loadWorkspaceForModify(params.gameDir);
  const nextStoryboarder = patchShot(prev.storyboarder, params.shotNumber, (shot) => {
    if (params.lineIndex < 0 || params.lineIndex >= shot.dialogueLines.length) {
      throw new Error(
        `modifyDialogueLine: shot ${params.shotNumber} has ${shot.dialogueLines.length} lines, cannot set index ${params.lineIndex}`,
      );
    }
    const oldLine = shot.dialogueLines[params.lineIndex]!;
    const newLine: StoryboarderOutputDialogueLine = {
      speaker: params.newSpeaker ?? oldLine.speaker,
      text: params.newText,
    };
    const lines = [...shot.dialogueLines];
    lines[params.lineIndex] = newLine;
    return { ...shot, dialogueLines: lines };
  });

  const next: StoryWorkspaceSnapshot = {
    planner: prev.planner,
    writer: prev.writer,
    storyboarder: nextStoryboarder,
  };
  await writeWorkspaceDoc('workspace://storyboard', params.gameDir, nextStoryboarder);
  if (hadAggregate) {
    await saveStoryWorkspace(params.gameDir, next);
  }
  return next;
}

// ---------------------------------------------------------------------------
// 3) 重排镜头(典型场景:"把 Shot 3 放到 Shot 1 前")
// ---------------------------------------------------------------------------

export interface ReorderShotsParams extends ModifyContext {
  /** 镜头新顺序,每个元素是原 shotNumber。长度必须等于现有 shots,且为全排列。 */
  readonly newOrder: ReadonlyArray<number>;
}

export async function reorderShots(
  params: ReorderShotsParams,
): Promise<StoryWorkspaceSnapshot> {
  const { snapshot: prev, hadAggregate } = await loadWorkspaceForModify(params.gameDir);
  const oldShots = prev.storyboarder.shots;

  if (params.newOrder.length !== oldShots.length) {
    throw new Error(
      `reorderShots: newOrder has ${params.newOrder.length} entries, expected ${oldShots.length}`,
    );
  }
  const seen = new Set<number>();
  const shotByNumber = new Map(oldShots.map((s) => [s.shotNumber, s]));
  const reordered: StoryboarderOutputShot[] = [];
  for (const [i, origNum] of params.newOrder.entries()) {
    if (seen.has(origNum)) {
      throw new Error(`reorderShots: duplicate shotNumber ${origNum} in newOrder`);
    }
    seen.add(origNum);
    const shot = shotByNumber.get(origNum);
    if (!shot) {
      throw new Error(`reorderShots: shotNumber ${origNum} not in current storyboarder`);
    }
    // Renumber 1-indexed to keep Coder's shot headers contiguous.
    reordered.push({ ...shot, shotNumber: i + 1 });
  }

  const nextStoryboarder: StoryboarderOutput = { shots: reordered };
  const next: StoryWorkspaceSnapshot = {
    planner: prev.planner,
    writer: prev.writer,
    storyboarder: nextStoryboarder,
  };
  await writeWorkspaceDoc('workspace://storyboard', params.gameDir, nextStoryboarder);
  if (hadAggregate) {
    await saveStoryWorkspace(params.gameDir, next);
  }
  return next;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function patchShot(
  board: StoryboarderOutput,
  shotNumber: number,
  mutate: (shot: StoryboarderOutputShot) => StoryboarderOutputShot,
): StoryboarderOutput {
  const idx = board.shots.findIndex((s) => s.shotNumber === shotNumber);
  if (idx < 0) {
    throw new Error(`patchShot: shotNumber ${shotNumber} not found`);
  }
  const shots = [...board.shots];
  shots[idx] = mutate(shots[idx]!);
  return { shots };
}

function defaultRegistryPath(gameDir: string): string {
  return registryPathForGame(gameDir);
}
