// V5 top-level orchestrator. Equivalent to run-pipeline.ts in the v0.2 serial
// world: takes an inspiration + story name, bootstraps workspace, then loops
// Planner tasks until the Planner declares Stage A done. Returns a result
// bundle compatible with the existing PipelineResult shape where possible.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import type { FetchLike } from '../assets/download.js';
import { runPlannerTask } from './planner.js';
import type { CommonToolContext, TaskAgentRegistry } from './common-tools.js';
import { workspaceDirForGame } from './workspace-index.js';
import { BudgetExceededError, BudgetTracker, wrapLlmClientWithBudget } from './budget.js';
import { appendPlannerMemory } from './memory.js';

export interface RunV5Params {
  readonly storyName: string;
  readonly inspiration: string;
  readonly llm: LlmClient;
  readonly gameDir: string;
  readonly taskAgents?: TaskAgentRegistry;
  readonly logger?: CommonToolContext['logger'];
  /** Max Planner tasks to try before giving up. Defaults to 40 (env V5_MAX_PLANNER_TASKS override). */
  readonly maxPlannerTasks?: number;
  /** Optional: Tier 2 tools need this to call RunningHub. Omit for scripted tests. */
  readonly runningHubClient?: RunningHubClient;
  readonly registryPath?: string;
  readonly fetchFn?: FetchLike;
  /**
   * Optional: safety cap in USD. When cumulative LLM spend (Sonnet 4.6 list
   * price, cacheReadInputTokens not discounted) exceeds this cap, the next
   * `chatWithTools` call throws `BudgetExceededError` and the Planner loop
   * lands a graceful finish with `budgetCappedEarly: true`.
   */
  readonly budgetCapUsd?: number;
  /**
   * Optional: per-call timeout for `call_task_agent` invocations. Covers
   * RunningHub submissions that hang (observed MJ v7 avg 2-3 min; default
   * 5 min leaves ample headroom).
   */
  readonly taskAgentTimeoutMs?: number;
}

export interface RunV5Result {
  readonly storyName: string;
  readonly gameDir: string;
  readonly plannerTaskCount: number;
  readonly finalSummary: string;
  /** Total LLM cost estimate in USD at Sonnet 4.6 list pricing (conservative). */
  readonly totalCostUsd: number;
  /** The cap that was set for this run, if any. */
  readonly budgetCapUsd?: number;
  /** True when a BudgetExceededError forced an early graceful exit. */
  readonly budgetCappedEarly: boolean;
}

function parseEnvMax(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
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

  const tracker = new BudgetTracker(params.budgetCapUsd);
  const wrappedLlm = wrapLlmClientWithBudget(params.llm, tracker);
  const logger = params.logger ?? defaultLogger();

  const ctx: CommonToolContext = {
    storyName: params.storyName,
    gameDir: params.gameDir,
    workspaceDir,
    memoryDir,
    taskAgents: params.taskAgents ?? {},
    logger,
    llm: wrappedLlm,
    ...(params.runningHubClient !== undefined
      ? { runningHubClient: params.runningHubClient }
      : {}),
    ...(params.registryPath !== undefined ? { registryPath: params.registryPath } : {}),
    ...(params.fetchFn !== undefined ? { fetchFn: params.fetchFn } : {}),
    ...(params.taskAgentTimeoutMs !== undefined
      ? { taskAgentTimeoutMs: params.taskAgentTimeoutMs }
      : {}),
  };

  const envMax = parseEnvMax(process.env.V5_MAX_PLANNER_TASKS);
  const maxPlannerTasks = params.maxPlannerTasks ?? envMax ?? 40;
  let finalSummary = '';
  let taskCount = 0;
  let budgetCappedEarly = false;

  for (let i = 0; i < maxPlannerTasks; i++) {
    try {
      const result = await runPlannerTask({
        storyName: params.storyName,
        llm: wrappedLlm,
        ctx,
        executerLlm: wrappedLlm,
      });
      taskCount++;
      finalSummary = result.taskSummary;
      if (result.done) break;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        budgetCappedEarly = true;
        finalSummary = `budget cap hit ($${err.totalCostUsd.toFixed(4)} > $${err.capUsd.toFixed(2)}), stopped early`;
        logger.warn('budget_cap_hit', {
          capUsd: err.capUsd,
          totalCostUsd: err.totalCostUsd,
          plannerTaskCount: taskCount,
        });
        // Persist a finish marker so rebuild / re-entry sees the budget stop.
        await appendPlannerMemory(memoryDir, {
          taskId: `budget-cap-${Date.now()}`,
          kind: 'finish',
          summary: finalSummary,
        });
        break;
      }
      throw err;
    }
  }

  return {
    storyName: params.storyName,
    gameDir: params.gameDir,
    plannerTaskCount: taskCount,
    finalSummary,
    totalCostUsd: tracker.totalCostUsd,
    ...(params.budgetCapUsd !== undefined ? { budgetCapUsd: params.budgetCapUsd } : {}),
    budgetCappedEarly,
  };
}
