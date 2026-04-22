import { resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import { runPlanner } from './planner.js';
import { runWriter } from './writer.js';
import { runStoryboarder } from './storyboarder.js';
import { writeGameProject } from './coder.js';
import { runQa } from './qa.js';
import type { PipelineResult } from './types.js';

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

  log.info(`[coder] generating .rpy into ${gameDir}...`);
  await writeGameProject({ planner, storyboarder, gameDir });
  log.info('[coder] done');

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
