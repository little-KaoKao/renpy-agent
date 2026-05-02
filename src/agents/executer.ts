// Executer sub-conversation loop. Runs one "task" assigned by the Planner:
// - starts with EXECUTER_SYSTEM_PROMPT + POC tool-set
// - loops tool_use / tool_result rounds
// - exits when the LLM emits output_with_finish
//
// Does NOT talk to Planner memory directly; the Executer's taskSummary is
// the return value that Planner will place into the handoff tool_result.

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
  call_task_agent,
  output_with_finish,
  output_with_plan,
  read_from_uri,
} from './common-tools.js';
import { getPocDescriptor, type PocRole } from './poc-registry.js';
import { getToolSetForRole } from './tool-binder.js';
import type { ToolExecutor } from './tool-schema.js';

export const EXECUTER_SYSTEM_PROMPT = `You are one of the POCs (Points of Contact) on a Ren'Py galgame production team.
You have just been handed off a specific task by the Planner. Follow these 7 rules:

1. You have already been handed a specific role. Use the tools available to you.
2. Work incrementally: call one tool at a time, read its tool_result, then decide the next step.
3. If a tool returns {"error": "..."}, read the error, adjust, and try again — do not repeat the same failing call.
4. You may read workspace documents with read_from_uri to check current state before making changes.
5. For image / background / prompt generation, use call_task_agent with the known agent names
   ("character_prompt_expander", "character_main_image_generator", "scene_background_generator").
6. You cannot hand off to another POC — only the Planner can. Finish your task and let Planner decide next.
7. When the task is done, call output_with_finish with a 1-3 sentence summary that will be surfaced to the Planner.
`;

const COMMON_EXECUTER_SCHEMAS: ReadonlyArray<LlmToolSchema> = [
  {
    name: 'output_with_plan',
    description: 'Declare a pseudocode plan for this task (purely for audit). Stored in planner_memories.',
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
      'Declare task completion and return a 1-3 sentence summary that Planner will see as the handoff tool_result.',
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
    description: 'Read a workspace document by URI (workspace://<kind>[/<slug>]).',
    inputSchema: {
      type: 'object',
      properties: { uri: { type: 'string' } },
      required: ['uri'],
    },
  },
  {
    name: 'call_task_agent',
    description:
      'Invoke a task agent (one-shot LLM helper). Known names: character_prompt_expander, character_main_image_generator, scene_background_generator.',
    inputSchema: {
      type: 'object',
      properties: {
        agentName: { type: 'string' },
        input: { type: 'object' },
      },
      required: ['agentName', 'input'],
    },
  },
];

// Tools exempt from the per-tool soft limit — repeating these in one handoff
// is legitimate (read_from_uri walks many URIs; plan/finish are emit-once but
// cheap if the LLM retries). All other tool names are capped at 2 calls per
// handoff to stop Executer-level repeat-emit (plan §9).
const SOFT_LIMIT_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  'read_from_uri',
  'output_with_plan',
  'output_with_finish',
]);

const PER_TOOL_SOFT_LIMIT = 2;

const COMMON_EXECUTER_EXECUTORS: Readonly<Record<string, ToolExecutor>> = {
  output_with_plan: (args, ctx) =>
    output_with_plan(args as { taskId: string; plan: string }, ctx) as Promise<
      Record<string, unknown>
    >,
  output_with_finish: (args, ctx) =>
    output_with_finish(
      args as { taskId: string; taskSummary: string },
      ctx,
    ) as Promise<Record<string, unknown>>,
  read_from_uri: (args, ctx) =>
    read_from_uri(args as { uri: string }, ctx) as Promise<Record<string, unknown>>,
  call_task_agent: (args, ctx) =>
    call_task_agent(
      args as { agentName: string; input: Record<string, unknown> },
      ctx,
    ) as Promise<Record<string, unknown>>,
};

export interface RunExecuterTaskParams {
  readonly pocRole: PocRole;
  readonly userBrief: string;
  readonly llm: LlmClient;
  readonly ctx: CommonToolContext;
  readonly maxTurns?: number;
}

export interface RunExecuterTaskResult {
  readonly taskSummary: string;
  readonly stopReason: LlmStopReason;
  readonly turns: number;
}

export async function runExecuterTask(
  params: RunExecuterTaskParams,
): Promise<RunExecuterTaskResult> {
  if (!params.llm.chatWithTools) {
    throw new Error('runExecuterTask: llm.chatWithTools not available');
  }
  const poc = getPocDescriptor(params.pocRole);
  const set = getToolSetForRole(params.pocRole);
  const maxTurns = params.maxTurns ?? 30;

  const schemas = [...COMMON_EXECUTER_SCHEMAS, ...set.schemas];
  const executors: Record<string, ToolExecutor> = {
    ...COMMON_EXECUTER_EXECUTORS,
    ...set.executors,
  };

  // Per-handoff counter for read_from_uri calls. Exposed to tools via the
  // injected ctx so tools (notably qa.run_qa) can enforce a read-before-act
  // quota. Local to this call — never leaks across handoffs.
  let readFromUriCount = 0;
  const ctxWithCounter: CommonToolContext = {
    ...params.ctx,
    readFromUriCount: () => readFromUriCount,
  };

  // Cacheable static segment:7 rules + POC identity + role-specific tool-set
  // 说明。对同一个 pocRole 的每次 handoff 都一样,天然适合 prompt cache。
  const cacheableSystemPrompt = [
    EXECUTER_SYSTEM_PROMPT,
    '',
    `Your role: ${poc.role}`,
    poc.description,
    '',
    'Role-specific tools available to you:',
    ...set.schemas.map((s) => `- ${s.name}: ${s.description}`),
  ].join('\n');

  const messages: LlmToolMessage[] = [
    { role: 'system', content: cacheableSystemPrompt, cacheControl: { type: 'ephemeral' } },
    { role: 'user', content: params.userBrief },
  ];

  let lastFinishSummary: string | null = null;
  let lastStopReason: LlmStopReason = 'end_turn';
  const toolCallCounts = new Map<string, number>();

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await params.llm.chatWithTools({
      messages,
      tools: schemas,
    });
    lastStopReason = res.stopReason;

    // Push assistant response as-is.
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
      // LLM stopped without a tool call — treat as implicit finish (empty summary).
      return {
        taskSummary: lastFinishSummary ?? '(no summary — LLM stopped without output_with_finish)',
        stopReason: lastStopReason,
        turns: turn + 1,
      };
    }

    // Execute every tool_use, collect tool_results.
    const toolResults: LlmToolResultBlock[] = [];
    for (const tu of toolUses) {
      // Per-tool soft limit: after PER_TOOL_SOFT_LIMIT calls of the same name
      // in one handoff, refuse further invocations and nudge the LLM to finish.
      // Exempt tools (read_from_uri / output_with_plan / output_with_finish)
      // bypass the counter entirely.
      if (!SOFT_LIMIT_EXEMPT_TOOLS.has(tu.name)) {
        const prev = toolCallCounts.get(tu.name) ?? 0;
        const n = prev + 1;
        toolCallCounts.set(tu.name, n);
        if (n > PER_TOOL_SOFT_LIMIT) {
          params.ctx.logger.warn('executer.soft_limit_hit', {
            tool: tu.name,
            count: n,
          });
          toolResults.push({
            type: 'tool_result',
            toolUseId: tu.id,
            content: JSON.stringify({
              error: `tool "${tu.name}" called ${n} times in this handoff; refusing to execute. Call output_with_finish now.`,
              retry: false,
              guidance: `You have already invoked ${tu.name} ${prev} times. Further invocations will not be executed. Call output_with_finish with a summary of what was accomplished, even if partial.`,
            }),
            isError: true,
          });
          continue;
        }
      }

      const executor = executors[tu.name];
      let resultContent: string;
      if (!executor) {
        resultContent = JSON.stringify({
          error: `unknown tool: ${tu.name}`,
        });
      } else {
        try {
          const out = await executor(
            (tu.input as Record<string, unknown>) ?? {},
            ctxWithCounter,
          );
          resultContent = JSON.stringify(out);
          if (tu.name === 'read_from_uri' && !('error' in out)) {
            readFromUriCount += 1;
          }
          if (tu.name === 'output_with_finish') {
            lastFinishSummary =
              typeof (tu.input as { taskSummary?: unknown }).taskSummary === 'string'
                ? (tu.input as { taskSummary: string }).taskSummary
                : null;
          }
        } catch (e) {
          resultContent = JSON.stringify({ error: (e as Error).message });
        }
      }
      toolResults.push({
        type: 'tool_result',
        toolUseId: tu.id,
        content: resultContent,
      });
    }

    messages.push({ role: 'user', content: toolResults });

    // Finish detection: any of the tool_uses was output_with_finish.
    if (toolUses.some((tu) => tu.name === 'output_with_finish')) {
      return {
        taskSummary: lastFinishSummary ?? '(empty summary)',
        stopReason: lastStopReason,
        turns: turn + 1,
      };
    }
  }

  throw new Error(`runExecuterTask(${params.pocRole}): exceeded maxTurns=${maxTurns}`);
}
