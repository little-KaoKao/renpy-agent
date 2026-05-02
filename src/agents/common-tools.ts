// V5 common tools — 5 real tools used by every POC + Planner, plus 3 stubs
// for the v0.7 workflow engine (active_workflow / check_workflow_params /
// get_workflow_guide).
//
// Scope chosen per Design §2.1 (option W2). These five are enough for the
// Stage A happy path and for the v0.7 "short hair" trace; workflow-guide
// triplet is a separate feature deferred to v0.7.

import { readFile } from 'node:fs/promises';
import type { LlmClient } from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import type { FetchLike } from '../assets/download.js';
import {
  appendPlannerMemory,
  loadPlannerMemories,
  type PlannerMemoryEntry,
} from './memory.js';
import {
  parseWorkspaceUri,
  resolveUriToPath,
  type WorkspaceKind,
} from './workspace-index.js';
import {
  getPocDescriptor,
  isPocRole,
  type PocRole,
} from './poc-registry.js';

export interface CommonToolLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Task agents are "one-shot LLM helpers" (PLAN §8). v0.6 ships 3 concrete
 * ones via injection (character_prompt_expander / character_main_image_generator /
 * scene_background_generator); others return {error: "not implemented"}.
 */
export type TaskAgentFn = (
  input: Record<string, unknown>,
  ctx: CommonToolContext,
) => Promise<Record<string, unknown>>;

export type TaskAgentRegistry = Partial<Record<string, TaskAgentFn>>;

export interface CommonToolContext {
  readonly storyName: string;
  readonly gameDir: string;
  readonly workspaceDir: string;
  readonly memoryDir: string;
  readonly taskAgents: TaskAgentRegistry;
  readonly logger: CommonToolLogger;
  /** Optional: tools that do LLM calls (writer, storyboarder, ui_designer) inject this. */
  readonly llm?: LlmClient;
  /** Optional: Tier 2 audio/image/video tools need this to submit RunningHub tasks. */
  readonly runningHubClient?: RunningHubClient;
  /**
   * Optional: path to asset-registry.json. Tier 2 tools use it with swapAssetPlaceholder /
   * markAssetError. Defaults to `<gameDir>/../asset-registry.json` when absent — tools
   * resolve this lazily via `registryPathForGame(ctx.gameDir)`.
   */
  readonly registryPath?: string;
  /** Optional: fetch override for asset downloads (tests pin this to a local server). */
  readonly fetchFn?: FetchLike;
  /**
   * Optional per-call timeout (ms) for `call_task_agent`. When a task agent
   * exceeds this, we abort with a `timeout` error and guidance to mark the
   * asset as placeholder. Undefined = no timeout (legacy behaviour).
   */
  readonly taskAgentTimeoutMs?: number;
}

// ── Planner side ────────────────────────────────────────────────────

export interface OutputWithPlanArgs {
  readonly taskId: string;
  readonly plan: string;
}

export async function output_with_plan(
  args: OutputWithPlanArgs,
  ctx: CommonToolContext,
): Promise<{ ok: true }> {
  // Detect orphan plan: previous plan has no matching finish AND taskId differs.
  // Observed in M0 real-key smoke: coder phase emitted 3 distinct taskIds in
  // sequence, only the last one produced finish. Surface a warn so the trace
  // log can attribute the re-plan; keep non-blocking because the LLM may have
  // legitimate reasons (e.g. QA kick-back triggers a fresh plan id).
  const prior = await loadPlannerMemories(ctx.memoryDir);
  const lastPlan = [...prior].reverse().find((e) => e.kind === 'plan');
  if (lastPlan && lastPlan.taskId !== args.taskId) {
    const hasFinish = prior.some(
      (e) => e.kind === 'finish' && e.taskId === lastPlan.taskId,
    );
    if (!hasFinish) {
      ctx.logger.warn('output_with_plan.orphan_previous', {
        previousTaskId: lastPlan.taskId,
        currentTaskId: args.taskId,
      });
    }
  }

  await appendPlannerMemory(ctx.memoryDir, {
    taskId: args.taskId,
    kind: 'plan',
    summary: args.plan,
  });
  ctx.logger.info('output_with_plan', { taskId: args.taskId });
  return { ok: true };
}

export interface OutputWithFinishArgs {
  readonly taskId: string;
  readonly taskSummary: string;
}

export async function output_with_finish(
  args: OutputWithFinishArgs,
  ctx: CommonToolContext,
): Promise<{ ok: true }> {
  await appendPlannerMemory(ctx.memoryDir, {
    taskId: args.taskId,
    kind: 'finish',
    summary: args.taskSummary,
  });
  ctx.logger.info('output_with_finish', { taskId: args.taskId });
  return { ok: true };
}

export interface ReadFromUriArgs {
  readonly uri: string;
}

export type ReadFromUriResult =
  | { readonly kind: WorkspaceKind; readonly content: unknown }
  | { readonly error: string };

export async function read_from_uri(
  args: ReadFromUriArgs,
  ctx: CommonToolContext,
): Promise<ReadFromUriResult> {
  let parsed;
  try {
    parsed = parseWorkspaceUri(args.uri);
  } catch (e) {
    return { error: (e as Error).message };
  }

  let path: string;
  try {
    path = resolveUriToPath(args.uri, ctx.gameDir);
  } catch (e) {
    return { error: (e as Error).message };
  }

  try {
    const text = await readFile(path, 'utf8');
    return { kind: parsed.kind, content: JSON.parse(text) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { error: `document not found at ${args.uri}` };
    }
    return { error: (e as Error).message };
  }
}

// ── Executer side ───────────────────────────────────────────────────

export interface HandoffToAgentArgs {
  readonly pocRole: PocRole;
}

export type HandoffToAgentResult =
  | { readonly pocRole: PocRole; readonly toolNames: ReadonlyArray<string>; readonly description: string }
  | { readonly error: string };

export async function handoff_to_agent(
  args: HandoffToAgentArgs,
  _ctx: CommonToolContext,
): Promise<HandoffToAgentResult> {
  if (!isPocRole(args.pocRole)) {
    return { error: `unknown POC role: ${args.pocRole}` };
  }
  const d = getPocDescriptor(args.pocRole);
  return { pocRole: d.role, toolNames: d.toolNames, description: d.description };
}

export interface CallTaskAgentArgs {
  readonly agentName: string;
  readonly input: Record<string, unknown>;
}

export type CallTaskAgentResult =
  | { readonly agentName: string; readonly output: Record<string, unknown> }
  | {
      readonly error: string;
      readonly retry: boolean;
      readonly guidance: string;
    };

const TASK_AGENT_TIMEOUT_SENTINEL = Symbol('task_agent_timeout');

export async function call_task_agent(
  args: CallTaskAgentArgs,
  ctx: CommonToolContext,
): Promise<CallTaskAgentResult> {
  const fn = ctx.taskAgents[args.agentName];
  if (!fn) {
    return {
      error: `task agent "${args.agentName}" not implemented in v0.6`,
      retry: false,
      guidance:
        'This task agent is not wired up in v0.6. Do not retry — mark the corresponding asset status as "placeholder" and move on; Stage B will fill it later.',
    };
  }
  try {
    const timeoutMs = ctx.taskAgentTimeoutMs;
    const output = await invokeWithOptionalTimeout(fn, args.input, ctx, timeoutMs);
    if (output === TASK_AGENT_TIMEOUT_SENTINEL) {
      ctx.logger.warn('task_agent_timeout', {
        agentName: args.agentName,
        timeoutMs,
      });
      return {
        error: `task agent "${args.agentName}" exceeded ${timeoutMs}ms timeout`,
        retry: false,
        guidance:
          'Task agent timed out. Do not retry in this run — mark the asset status "placeholder" (or "error") and let Stage B handle it later.',
      };
    }
    return { agentName: args.agentName, output };
  } catch (e) {
    return {
      error: (e as Error).message,
      retry: true,
      guidance:
        'Transient task-agent failure. You may retry once with the same input; if it still fails, mark the asset status "error" and continue with a placeholder.',
    };
  }
}

async function invokeWithOptionalTimeout(
  fn: TaskAgentFn,
  input: Record<string, unknown>,
  ctx: CommonToolContext,
  timeoutMs: number | undefined,
): Promise<Record<string, unknown> | typeof TASK_AGENT_TIMEOUT_SENTINEL> {
  if (timeoutMs === undefined) {
    return fn(input, ctx);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TASK_AGENT_TIMEOUT_SENTINEL>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(TASK_AGENT_TIMEOUT_SENTINEL), timeoutMs);
  });
  try {
    return await Promise.race([fn(input, ctx), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── Workflow stubs (v0.6 unavailable) ───────────────────────────────

export interface WorkflowArgs {
  readonly workflowName: string;
}

interface WorkflowUnavailable {
  readonly error: string;
  readonly retry: false;
  readonly guidance: string;
}

const WORKFLOW_UNAVAILABLE: WorkflowUnavailable = {
  error: 'workflow engine v0.6 unavailable; deferred to v0.7',
  retry: false,
  guidance:
    'The workflow guide / param-check triplet is not shipped in v0.6. Proceed without workflow metadata; the POC description and tool schemas are sufficient for Stage A.',
};

export async function active_workflow(
  _args: WorkflowArgs,
  _ctx: CommonToolContext,
): Promise<WorkflowUnavailable> {
  return WORKFLOW_UNAVAILABLE;
}

export async function check_workflow_params(
  _args: WorkflowArgs,
  _ctx: CommonToolContext,
): Promise<WorkflowUnavailable> {
  return WORKFLOW_UNAVAILABLE;
}

export async function get_workflow_guide(
  _args: WorkflowArgs,
  _ctx: CommonToolContext,
): Promise<WorkflowUnavailable> {
  return WORKFLOW_UNAVAILABLE;
}

// Re-export memory type for convenience (Planner loop wants it).
export type { PlannerMemoryEntry };
