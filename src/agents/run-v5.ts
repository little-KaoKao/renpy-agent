// V5 top-level orchestrator. Equivalent to run-pipeline.ts in the v0.2 serial
// world: takes an inspiration + story name, bootstraps workspace, then loops
// Planner tasks until the Planner declares Stage A done. Returns a result
// bundle compatible with the existing PipelineResult shape where possible.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import type { FetchLike } from '../assets/download.js';
import { runPlannerTask } from './planner.js';
import type { CommonToolContext, TaskAgentRegistry } from './common-tools.js';
import { workspaceDirForGame } from './workspace-index.js';
import { BudgetExceededError, BudgetTracker, wrapLlmClientWithBudget } from './budget.js';
import { appendPlannerMemory } from './memory.js';
import { buildDefaultTaskAgents } from '../executers/task-agents/index.js';

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

  // Bootstrap default task-agents (§5.4). When the caller passes `taskAgents`
  // explicitly (scripted tests) honour that; otherwise inject the 3 real agents
  // and let each call switch to DRY_RUN via input hint or env. When neither
  // runningHubClient nor RUNNINGHUB_API_KEY is available, fall back to a
  // force-DRY_RUN registry so the call_task_agent path still exercises end-to-
  // end, but no real money is spent.
  const hasRhKey = Boolean(process.env.RUNNINGHUB_API_KEY);
  const canRunReal = params.runningHubClient !== undefined && hasRhKey;
  let taskAgents: TaskAgentRegistry;
  if (params.taskAgents !== undefined) {
    taskAgents = params.taskAgents;
  } else if (canRunReal) {
    taskAgents = buildDefaultTaskAgents(false);
  } else {
    logger.warn('task_agents.dry_run_fallback', {
      reason: params.runningHubClient === undefined
        ? 'no runningHubClient injected'
        : 'RUNNINGHUB_API_KEY env not set',
    });
    taskAgents = buildDefaultTaskAgents(true);
  }

  const ctx: CommonToolContext = {
    storyName: params.storyName,
    gameDir: params.gameDir,
    workspaceDir,
    memoryDir,
    taskAgents,
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

export interface RunV5ModifyParams {
  readonly storyName: string;
  /** Natural-language modification request, e.g. "change Baiying to have short hair". */
  readonly modifyIntent: string;
  readonly llm: LlmClient;
  readonly gameDir: string;
  readonly taskAgents?: TaskAgentRegistry;
  readonly logger?: CommonToolContext['logger'];
  /** Max Planner tasks to try before giving up. Defaults to 20 (modify runs are shorter than generate). */
  readonly maxPlannerTasks?: number;
  readonly runningHubClient?: RunningHubClient;
  readonly registryPath?: string;
  readonly fetchFn?: FetchLike;
  readonly budgetCapUsd?: number;
  readonly taskAgentTimeoutMs?: number;
}

export interface RunV5ModifyResult {
  readonly storyName: string;
  readonly gameDir: string;
  readonly plannerTaskCount: number;
  readonly finalSummary: string;
  readonly totalCostUsd: number;
  readonly budgetCapUsd?: number;
  readonly budgetCappedEarly: boolean;
  /** The intent that was passed in; echoed back for audit / logging. */
  readonly modifyIntent: string;
}

/**
 * Modify-mode top-level orchestrator (§5.5). Unlike `runV5`:
 * - requires an EXISTING workspace (errors if workspace/ does not exist yet)
 * - skips the inspiration.txt bootstrap
 * - runs a single Planner loop in mode:'modify' with the user's intent
 *
 * The Planner is responsible for: reading relevant URIs, handing off to the
 * right POC(s), and ultimately handing off to coder + qa so the .rpy project
 * is rebuilt and linted. The orchestrator does NOT call coder/qa directly —
 * that's the Planner's job in V5.
 */
export async function runV5Modify(params: RunV5ModifyParams): Promise<RunV5ModifyResult> {
  const workspaceDir = workspaceDirForGame(params.gameDir);
  const memoryDir = resolve(params.gameDir, '..', 'planner_memories');

  // Hard precondition: the workspace directory must already exist. If it
  // doesn't, the caller is trying to modify a story that was never generated —
  // fail fast with a clear error instead of letting Planner wander.
  try {
    const s = await stat(workspaceDir);
    if (!s.isDirectory()) {
      throw new Error(
        `runV5Modify: expected workspace directory at ${workspaceDir}, found non-directory`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `runV5Modify: workspace not found at ${workspaceDir}. Run \`renpy-agent v5\` (or generate) first before modifying.`,
      );
    }
    throw err;
  }
  await mkdir(memoryDir, { recursive: true });

  const tracker = new BudgetTracker(params.budgetCapUsd);
  const wrappedLlm = wrapLlmClientWithBudget(params.llm, tracker);
  const logger = params.logger ?? defaultLogger();

  const hasRhKey = Boolean(process.env.RUNNINGHUB_API_KEY);
  const canRunReal = params.runningHubClient !== undefined && hasRhKey;
  let taskAgents: TaskAgentRegistry;
  if (params.taskAgents !== undefined) {
    taskAgents = params.taskAgents;
  } else if (canRunReal) {
    taskAgents = buildDefaultTaskAgents(false);
  } else {
    logger.warn('task_agents.dry_run_fallback', {
      reason: params.runningHubClient === undefined
        ? 'no runningHubClient injected'
        : 'RUNNINGHUB_API_KEY env not set',
    });
    taskAgents = buildDefaultTaskAgents(true);
  }

  const ctx: CommonToolContext = {
    storyName: params.storyName,
    gameDir: params.gameDir,
    workspaceDir,
    memoryDir,
    taskAgents,
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
  const maxPlannerTasks = params.maxPlannerTasks ?? envMax ?? 20;
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
        mode: 'modify',
        modifyIntent: params.modifyIntent,
      });
      taskCount++;
      finalSummary = result.taskSummary;
      if (result.done) break;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        budgetCappedEarly = true;
        finalSummary = `budget cap hit ($${err.totalCostUsd.toFixed(4)} > $${err.capUsd.toFixed(2)}), modify stopped early`;
        logger.warn('budget_cap_hit', {
          capUsd: err.capUsd,
          totalCostUsd: err.totalCostUsd,
          plannerTaskCount: taskCount,
          mode: 'modify',
        });
        await appendPlannerMemory(memoryDir, {
          taskId: `budget-cap-modify-${Date.now()}`,
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
    modifyIntent: params.modifyIntent,
  };
}
