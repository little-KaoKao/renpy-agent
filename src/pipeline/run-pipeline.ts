import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../assets/registry.js';
import { StageParseError } from '../llm/stage-parse-error.js';
import type {
  PlannerOutput,
  StoryboarderOutput,
  WriterOutput,
} from './types.js';
import { runPlanner } from './planner.js';
import { runWriter } from './writer.js';
import { runStoryboarder } from './storyboarder.js';
import { writeGameProject } from './coder.js';
import { runQa } from './qa.js';
import type { PipelineResult } from './types.js';
import {
  saveAudioUiWorkspace,
  saveStoryWorkspace,
  savePlannerSnapshot,
  saveWriterSnapshot,
  saveStoryboarderSnapshot,
  tryLoadStageSnapshots,
  workspacePathsForGame,
} from './workspace.js';
import { runAudioUiStage, type AudioUiStageStats } from './audio-ui.js';
import { runCutsceneStage, type CutsceneStageStats } from './cutscene-stage.js';
import { runVisualStage, type VisualStageStats } from './visual-stage.js';

export interface PipelineLogger {
  info(message: string): void;
  error(message: string): void;
}

export const consoleLogger: PipelineLogger = {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
};

export interface RunPipelineParams {
  readonly inspiration: string;
  readonly storyName: string;
  readonly llm: LlmClient;
  readonly repoRoot?: string;
  readonly logger?: PipelineLogger;
  /**
   * v0.5: when true, run the minimal audio/UI generation stage between
   * Storyboarder and Coder. Requires `runningHubClient` to be provided.
   * Defaults to false (byte-identical to v0.4 behaviour).
   */
  readonly enableAudioUi?: boolean;
  /**
   * v0.5+: when true, auto-route `storyboarder.shots[*].cutscene` to
   * `generateCutsceneVideo`. Runs after audio-ui (so audio assets are already
   * in the registry) and before Coder. Requires `runningHubClient`. Individual
   * failures don't collapse the pipeline — Coder falls back to the black-screen
   * placeholder for shots without a ready cutscene.
   */
  readonly enableCutscene?: boolean;
  /**
   * v0.6+: when true, run the visual asset stage between Storyboarder and
   * audio-ui. Produces character main images (MJv7) + scene backgrounds
   * (Nanobanana2) and registers them in the AssetRegistry so Coder emits real
   * `image` statements instead of `Solid` placeholders. Requires
   * `runningHubClient`. Single asset failures degrade to Stage-A Solid, don't
   * collapse the pipeline.
   */
  readonly enableVisual?: boolean;
  readonly runningHubClient?: RunningHubClient;
  /**
   * When true, reuse whichever stage snapshots already exist under
   * `workspace/` (planner.json / writer.json / storyboarder.json) and skip
   * those LLM stages. Useful to recover from a mid-pipeline failure without
   * re-burning tokens on already-successful stages.
   */
  readonly resume?: boolean;
}

export async function runPipeline(params: RunPipelineParams): Promise<PipelineResult> {
  const log = params.logger ?? consoleLogger;
  const repoRoot = params.repoRoot ?? process.cwd();
  const gameDir = resolve(repoRoot, 'runtime', 'games', params.storyName, 'game');

  const resumed = params.resume ? await tryLoadStageSnapshots(gameDir) : {};

  let planner: PlannerOutput;
  if (resumed.planner) {
    planner = resumed.planner;
    log.info(
      `[planner] RESUMED from workspace (project="${planner.projectTitle}" chars=${planner.characters.length} scenes=${planner.scenes.length})`,
    );
  } else {
    log.info(`[planner] planning for "${params.storyName}"...`);
    planner = await runStageWithRawDump('planner', gameDir, log, () =>
      runPlanner({ inspiration: params.inspiration, llm: params.llm }),
    );
    await savePlannerSnapshot(gameDir, planner);
    log.info(
      `[planner] project="${planner.projectTitle}" chars=${planner.characters.length} scenes=${planner.scenes.length} (snapshot saved)`,
    );
  }

  let writer: WriterOutput;
  if (resumed.writer) {
    writer = resumed.writer;
    log.info(`[writer] RESUMED from workspace (${writer.scenes.length} scenes)`);
  } else {
    log.info('[writer] drafting script...');
    writer = await runStageWithRawDump('writer', gameDir, log, () =>
      runWriter({ planner, llm: params.llm }),
    );
    await saveWriterSnapshot(gameDir, writer);
    log.info(`[writer] wrote ${writer.scenes.length} script scenes (snapshot saved)`);
  }

  let storyboarder: StoryboarderOutput;
  if (resumed.storyboarder) {
    storyboarder = resumed.storyboarder;
    log.info(`[storyboarder] RESUMED from workspace (${storyboarder.shots.length} shots)`);
  } else {
    log.info('[storyboarder] condensing into shots...');
    storyboarder = await runStageWithRawDump('storyboarder', gameDir, log, () =>
      runStoryboarder({ planner, writer, llm: params.llm }),
    );
    await saveStoryboarderSnapshot(gameDir, storyboarder);
    log.info(`[storyboarder] produced ${storyboarder.shots.length} shots (snapshot saved)`);
  }

  let visualStats: VisualStageStats | undefined;
  if (params.enableVisual) {
    if (!params.runningHubClient) {
      throw new Error(
        'runPipeline: enableVisual=true requires runningHubClient. ' +
          'Pass an HttpRunningHubClient (or mock) via RunPipelineParams.runningHubClient.',
      );
    }
    log.info('[visual] generating character main images + scene backgrounds...');
    const registryPath = registryPathForGame(gameDir);
    const stage = await runVisualStage({
      planner,
      gameDir,
      registryPath,
      runningHubClient: params.runningHubClient,
      logger: log,
    });
    visualStats = stage.stats;
  }

  let audioUiStats: AudioUiStageStats | undefined;
  let uiPatches: ReadonlyArray<{ readonly screen: string; readonly patch: string }> = [];
  if (params.enableAudioUi) {
    if (!params.runningHubClient) {
      throw new Error(
        'runPipeline: enableAudioUi=true requires runningHubClient. ' +
          'Pass an HttpRunningHubClient (or mock) via RunPipelineParams.runningHubClient.',
      );
    }
    log.info('[audio-ui] generating BGM / voice / SFX / UI...');
    const registryPath = registryPathForGame(gameDir);
    const stage = await runAudioUiStage({
      planner,
      writer,
      storyboarder,
      gameDir,
      registryPath,
      runningHubClient: params.runningHubClient,
      llm: params.llm,
      logger: log,
    });
    audioUiStats = stage.stats;
    uiPatches = stage.uiPatches;
    await saveAudioUiWorkspace(gameDir, {
      bgm: stage.bgm,
      voice: stage.voice,
      sfx: stage.sfx,
      ui: stage.ui,
    });
  }

  let cutsceneStats: CutsceneStageStats | undefined;
  if (params.enableCutscene) {
    if (!params.runningHubClient) {
      throw new Error(
        'runPipeline: enableCutscene=true requires runningHubClient. ' +
          'Pass an HttpRunningHubClient (or mock) via RunPipelineParams.runningHubClient.',
      );
    }
    log.info('[cutscene] auto-routing shot.cutscene to Seedance2.0...');
    const stage = await runCutsceneStage({
      storyboarder,
      gameDir,
      registryPath: registryPathForGame(gameDir),
      runningHubClient: params.runningHubClient,
      logger: log,
    });
    cutsceneStats = stage.stats;
  }

  log.info(`[coder] generating .rpy into ${gameDir}...`);
  // Reload the registry so Coder sees visual / audio / cutscene assets any
  // stage just produced.
  const assetRegistry =
    params.enableVisual || params.enableAudioUi || params.enableCutscene
      ? await loadRegistry(registryPathForGame(gameDir))
      : undefined;
  await writeGameProject({
    planner,
    storyboarder,
    gameDir,
    ...(assetRegistry !== undefined ? { assetRegistry } : {}),
    ...(uiPatches.length > 0 ? { uiPatches } : {}),
  });
  await saveStoryWorkspace(gameDir, { planner, writer, storyboarder });
  log.info('[coder] done (workspace snapshot saved)');

  log.info('[qa] running renpy lint...');
  const testRun = await runQa({ gamePath: gameDir, repoRoot });
  log.info(`[qa] result=${testRun.result}${testRun.warningMessage ? ` (${testRun.warningMessage})` : ''}`);
  if (testRun.syntaxErrors.length > 0 || testRun.runtimeErrors.length > 0) {
    for (const e of testRun.syntaxErrors) log.error(`[qa] syntax: ${e}`);
    for (const e of testRun.runtimeErrors) log.error(`[qa] runtime: ${e}`);
  }

  return {
    storyName: params.storyName,
    gamePath: gameDir,
    planner,
    writer,
    storyboarder,
    testRun,
    ...(visualStats !== undefined ? { visual: visualStats } : {}),
    ...(audioUiStats !== undefined ? { audioUi: audioUiStats } : {}),
    ...(cutsceneStats !== undefined ? { cutscene: cutsceneStats } : {}),
  };
}

/**
 * Run a stage fn. If it throws a StageParseError (or anything carrying a
 * `rawResponse`), dump the LLM's raw text to `workspace/debug/<stage>-raw-<ts>.txt`
 * so we can diagnose without re-burning tokens. Non-parse errors (network / SDK)
 * pass through untouched.
 */
async function runStageWithRawDump<T>(
  stage: 'planner' | 'writer' | 'storyboarder',
  gameDir: string,
  log: PipelineLogger,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StageParseError) {
      try {
        const paths = workspacePathsForGame(gameDir);
        const debugDir = resolve(paths.workspaceDir, 'debug');
        await mkdir(debugDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const path = resolve(debugDir, `${stage}-raw-${stamp}.txt`);
        await writeFile(path, e.rawResponse, 'utf8');
        log.error(`[${stage}] raw response dumped to ${path}`);
      } catch (dumpErr) {
        log.error(`[${stage}] raw dump failed: ${String((dumpErr as Error).message)}`);
      }
    }
    throw e;
  }
}

export function slugifyStoryName(raw: string | undefined, now: Date = new Date()): string {
  if (raw && raw.trim().length > 0) {
    const slug = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug.length > 0) return slug;
  }
  const pad = (n: number) => n.toString().padStart(2, '0');
  return [
    'story',
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join('-');
}
