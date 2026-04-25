// V5 top-level orchestrator. Equivalent to run-pipeline.ts in the v0.2 serial
// world: takes an inspiration + story name, bootstraps workspace, then loops
// Planner tasks until the Planner declares Stage A done. Returns a result
// bundle compatible with the existing PipelineResult shape where possible.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import { runPlannerTask } from './planner.js';
import type { CommonToolContext, TaskAgentRegistry } from './common-tools.js';
import { workspaceDirForGame } from './workspace-index.js';

export interface RunV5Params {
  readonly storyName: string;
  readonly inspiration: string;
  readonly llm: LlmClient;
  readonly gameDir: string;
  readonly taskAgents?: TaskAgentRegistry;
  readonly logger?: CommonToolContext['logger'];
  /** Max Planner tasks to try before giving up. */
  readonly maxPlannerTasks?: number;
}

export interface RunV5Result {
  readonly storyName: string;
  readonly gameDir: string;
  readonly plannerTaskCount: number;
  readonly finalSummary: string;
}

function defaultLogger(): CommonToolContext['logger'] {
  return {
    info: (msg, meta) => console.log(`[v5:info] ${msg}`, meta ?? ''),
    warn: (msg, meta) => console.warn(`[v5:warn] ${msg}`, meta ?? ''),
    error: (msg, meta) => console.error(`[v5:error] ${msg}`, meta ?? ''),
  };
}

export async function runV5(params: RunV5Params): Promise<RunV5Result> {
  const workspaceDir = workspaceDirForGame(params.gameDir);
  const memoryDir = resolve(params.gameDir, '..', 'planner_memories');

  await mkdir(workspaceDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
  // Bootstrap inspiration so Planner can read it via read_from_uri if it ever
  // decides to. Not a URI-indexed kind for v0.6, but stored for audit.
  await writeFile(
    resolve(workspaceDir, 'inspiration.txt'),
    params.inspiration,
    'utf8',
  );

  const ctx: CommonToolContext = {
    storyName: params.storyName,
    gameDir: params.gameDir,
    workspaceDir,
    memoryDir,
    taskAgents: params.taskAgents ?? {},
    logger: params.logger ?? defaultLogger(),
    llm: params.llm,
  };

  const maxPlannerTasks = params.maxPlannerTasks ?? 20;
  let finalSummary = '';
  let taskCount = 0;

  for (let i = 0; i < maxPlannerTasks; i++) {
    const result = await runPlannerTask({
      storyName: params.storyName,
      llm: params.llm,
      ctx,
      executerLlm: params.llm,
    });
    taskCount++;
    finalSummary = result.taskSummary;
    if (result.done) break;
  }

  return {
    storyName: params.storyName,
    gameDir: params.gameDir,
    plannerTaskCount: taskCount,
    finalSummary,
  };
}
