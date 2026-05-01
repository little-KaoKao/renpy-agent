// Planner top-level conversation loop. One Planner "task" = one conversation.
// Tools available at the Planner level: 4 common tools (plan / finish /
// read_from_uri / handoff_to_agent). The Planner NEVER invokes POC-specific
// tools directly — it hands off via handoff_to_agent, which the host turns
// into a sub-conversation driven by runExecuterTask.

import type {
  LlmClient,
  LlmStopReason,
  LlmTextBlock,
  LlmToolMessage,
  LlmToolResultBlock,
  LlmToolSchema,
  LlmToolUseBlock,
} from '../llm/types.js';
import type { CommonToolContext } from './common-tools.js';
import {
  output_with_plan,
  output_with_finish,
  read_from_uri,
} from './common-tools.js';
import {
  buildWorkspaceIndex,
  type WorkspaceIndex,
} from './workspace-index.js';
import {
  loadPlannerMemories,
  formatMemoriesForPrompt,
  type PlannerMemoryEntry,
} from './memory.js';
import { runExecuterTask } from './executer.js';
import { isPocRole, type PocRole } from './poc-registry.js';

export const PLANNER_SYSTEM_PROMPT = `You are the Planner for a Ren'Py galgame production pipeline.
Your job: decide the next task to push the project toward a playable Stage A demo.

Rules:
1. You cannot generate assets yourself. To get work done, hand off to a POC with handoff_to_agent.
2. Known POC roles:
   producer, writer, storyboarder, character_designer, scene_designer,
   music_director, voice_director, sfx_designer, ui_designer, coder, qa.
3. A sensible Stage A order: producer (create project + chapter) -> character_designer(s)
   -> scene_designer(s) -> writer -> storyboarder -> coder -> qa.
4. Before acting, you may inspect workspace state with read_from_uri.
5. When all required POCs have run and you see nothing else to push forward,
   call output_with_finish with taskSummary="no more tasks, Stage A delivered".
6. Each turn: call exactly ONE tool_use. Read its result, then plan the next call.
7. You may use output_with_plan once at the start of a task to declare (in pseudo-code)
   what you intend to do; this is only for audit, the host does not parse it.
8. IDEMPOTENT RE-ENTRY: if the workspace index shows project + chapter + script + storyboard
   already exist AND prior memories include a finish with "Stage A delivered" / "no more tasks",
   you should call output_with_finish immediately with the same wording. Do NOT re-read every
   URI — trust the memory log. This saves a full LLM round-trip on rebuild.
`;

const PLANNER_SCHEMAS: ReadonlyArray<LlmToolSchema> = [
  {
    name: 'output_with_plan',
    description: 'Declare a pseudo-code plan for this task (audit trail).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        plan: { type: 'string' },
      },
      required: ['taskId', 'plan'],
    },
  },
  {
    name: 'output_with_finish',
    description:
      'End this Planner task. Use taskSummary="no more tasks, Stage A delivered" to signal full completion to the main loop.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        taskSummary: { type: 'string' },
      },
      required: ['taskId', 'taskSummary'],
    },
  },
  {
    name: 'read_from_uri',
    description: 'Read a workspace document (workspace://<kind>[/<slug>]).',
    inputSchema: {
      type: 'object',
      properties: { uri: { type: 'string' } },
      required: ['uri'],
    },
  },
  {
    name: 'handoff_to_agent',
    description:
      'Hand off the current task to a POC. Pass pocRole and (optional) brief describing what you want done. ' +
      "The tool_result will be the POC's taskSummary.",
    inputSchema: {
      type: 'object',
      properties: {
        pocRole: { type: 'string' },
        brief: { type: 'string' },
      },
      required: ['pocRole'],
    },
  },
];

export interface RunPlannerTaskParams {
  readonly storyName: string;
  readonly llm: LlmClient;
  readonly ctx: CommonToolContext;
  /** Separate LLM handle for sub-conversations (can be the same as llm). */
  readonly executerLlm: LlmClient;
  readonly maxTurns?: number;
  /** For tests: override the task-agent registry passed into Executer ctx. */
  readonly executerCtxOverrides?: Partial<CommonToolContext>;
}

export interface RunPlannerTaskResult {
  readonly done: boolean;
  readonly taskSummary: string;
  readonly stopReason: LlmStopReason;
  readonly turns: number;
}

export async function runPlannerTask(
  params: RunPlannerTaskParams,
): Promise<RunPlannerTaskResult> {
  if (!params.llm.chatWithTools) {
    throw new Error('runPlannerTask: llm.chatWithTools not available');
  }
  const maxTurns = params.maxTurns ?? 30;

  const index = await buildWorkspaceIndex(params.ctx.gameDir);
  const memories = await loadPlannerMemories(params.ctx.memoryDir);

  // 分两段 system:第一段是 bytewise 恒定的 Planner 7 条规则(适合 prompt cache),
  // 第二段是 storyName / workspace index / memories(每轮都在变,不打 cache)。
  const messages: LlmToolMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT, cacheControl: { type: 'ephemeral' } },
    { role: 'system', content: buildPlannerDynamicSegment(params.storyName, index, memories) },
    {
      role: 'user',
      content: `Project "${params.storyName}". Decide the next task to push Stage A forward, or finish if no more tasks are needed.`,
    },
  ];

  let lastFinishSummary: string | null = null;
  let lastStopReason: LlmStopReason = 'end_turn';

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await params.llm.chatWithTools({
      messages,
      tools: PLANNER_SCHEMAS,
    });
    lastStopReason = res.stopReason;

    const assistantContent: Array<LlmTextBlock | LlmToolUseBlock> = [];
    for (const block of res.content) {
      if (block.type === 'text' || block.type === 'tool_use') {
        assistantContent.push(block);
      }
    }
    messages.push({ role: 'assistant', content: assistantContent });

    const toolUses = res.content.filter(
      (b): b is LlmToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      break;
    }

    const toolResults: LlmToolResultBlock[] = [];
    let finishTriggered = false;
    for (const tu of toolUses) {
      let resultContent: string;
      try {
        resultContent = await dispatchPlannerTool(tu, params);
      } catch (e) {
        resultContent = JSON.stringify({ error: (e as Error).message });
      }
      toolResults.push({
        type: 'tool_result',
        toolUseId: tu.id,
        content: resultContent,
      });
      if (tu.name === 'output_with_finish') {
        finishTriggered = true;
        const summary = (tu.input as { taskSummary?: unknown }).taskSummary;
        if (typeof summary === 'string') lastFinishSummary = summary;
      }
    }

    messages.push({ role: 'user', content: toolResults });

    if (finishTriggered) {
      const summary = lastFinishSummary ?? '';
      const done = isDoneSummary(summary);
      return { done, taskSummary: summary, stopReason: lastStopReason, turns: turn + 1 };
    }
  }

  throw new Error(`runPlannerTask: exceeded maxTurns=${maxTurns}`);
}

/**
 * @deprecated Kept for potential external imports. Prefer using the two-segment
 * system message (PLANNER_SYSTEM_PROMPT + buildPlannerDynamicSegment) so the
 * static half can be prompt-cached.
 */
function buildPlannerSystemPrompt(
  storyName: string,
  index: WorkspaceIndex,
  memories: ReadonlyArray<PlannerMemoryEntry>,
): string {
  return [
    PLANNER_SYSTEM_PROMPT,
    '',
    buildPlannerDynamicSegment(storyName, index, memories),
  ].join('\n');
}

function buildPlannerDynamicSegment(
  storyName: string,
  index: WorkspaceIndex,
  memories: ReadonlyArray<PlannerMemoryEntry>,
): string {
  const parts = [
    `Project: ${storyName}`,
    '',
    'Current workspace index:',
    index.formatForPrompt(),
    '',
    'Completed tasks (from planner_memories):',
    formatMemoriesForPrompt(memories),
  ];
  if (hasPriorDelivery(memories)) {
    parts.push(
      '',
      'NOTE: prior memories indicate Stage A was already delivered. Per Rule 8, ' +
        'if the workspace still looks complete, call output_with_finish immediately ' +
        'with taskSummary="no more tasks, Stage A delivered" instead of re-verifying each URI.',
    );
  }
  return parts.join('\n');
}

function hasPriorDelivery(memories: ReadonlyArray<PlannerMemoryEntry>): boolean {
  return memories.some(
    (e) =>
      e.kind === 'finish' &&
      /no more tasks|stage a delivered|all tasks (complete|done)/i.test(e.summary),
  );
}

async function dispatchPlannerTool(
  tu: LlmToolUseBlock,
  params: RunPlannerTaskParams,
): Promise<string> {
  const input = (tu.input as Record<string, unknown>) ?? {};
  switch (tu.name) {
    case 'output_with_plan': {
      const r = await output_with_plan(
        { taskId: String(input.taskId ?? ''), plan: String(input.plan ?? '') },
        params.ctx,
      );
      return JSON.stringify(r);
    }
    case 'output_with_finish': {
      const r = await output_with_finish(
        {
          taskId: String(input.taskId ?? ''),
          taskSummary: String(input.taskSummary ?? ''),
        },
        params.ctx,
      );
      return JSON.stringify(r);
    }
    case 'read_from_uri': {
      const r = await read_from_uri({ uri: String(input.uri ?? '') }, params.ctx);
      return JSON.stringify(r);
    }
    case 'handoff_to_agent': {
      const role = String(input.pocRole ?? '');
      if (!isPocRole(role)) {
        return JSON.stringify({ error: `unknown POC role: ${role}` });
      }
      const brief =
        typeof input.brief === 'string' && input.brief.length > 0
          ? input.brief
          : `You are handed off as ${role}. Do your part for project ${params.storyName}.`;
      const executerCtx: CommonToolContext = {
        ...params.ctx,
        ...(params.executerCtxOverrides ?? {}),
      };
      const result = await runExecuterTask({
        pocRole: role as PocRole,
        userBrief: brief,
        llm: params.executerLlm,
        ctx: executerCtx,
      });
      return JSON.stringify({
        pocRole: role,
        taskSummary: result.taskSummary,
        turns: result.turns,
      });
    }
    default:
      return JSON.stringify({ error: `unknown tool: ${tu.name}` });
  }
}

function isDoneSummary(summary: string): boolean {
  return /no more tasks|stage a delivered|all tasks (complete|done)/i.test(summary);
}
