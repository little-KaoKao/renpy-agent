import { resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../assets/registry.js';
import { runPlanner } from './planner.js';
import { runWriter } from './writer.js';
import { runStoryboarder } from './storyboarder.js';
import { writeGameProject } from './coder.js';
import { runQa } from './qa.js';
import type { PipelineResult } from './types.js';
import { saveAudioUiWorkspace, saveStoryWorkspace } from './workspace.js';
import { runAudioUiStage, type AudioUiStageStats } from './audio-ui.js';

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
  readonly runningHubClient?: RunningHubClient;
}

export async function runPipeline(params: RunPipelineParams): Promise<PipelineResult> {
  const log = params.logger ?? consoleLogger;
  const repoRoot = params.repoRoot ?? process.cwd();
  const gameDir = resolve(repoRoot, 'runtime', 'games', params.storyName, 'game');

  log.info(`[planner] planning for "${params.storyName}"...`);
  const planner = await runPlanner({ inspiration: params.inspiration, llm: params.llm });
  log.info(`[planner] project="${planner.projectTitle}" chars=${planner.characters.length} scenes=${planner.scenes.length}`);

  log.info('[writer] drafting script...');
  const writer = await runWriter({ planner, llm: params.llm });
  log.info(`[writer] wrote ${writer.scenes.length} script scenes`);

  log.info('[storyboarder] condensing into shots...');
  const storyboarder = await runStoryboarder({ planner, writer, llm: params.llm });
  log.info(`[storyboarder] produced ${storyboarder.shots.length} shots`);

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

  log.info(`[coder] generating .rpy into ${gameDir}...`);
  // Reload the registry so Coder sees audio assets the stage just produced.
  const assetRegistry = params.enableAudioUi
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
    ...(audioUiStats !== undefined ? { audioUi: audioUiStats } : {}),
  };
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
