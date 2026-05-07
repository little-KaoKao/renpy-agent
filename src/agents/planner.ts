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
import { SCHEMA_DIGEST } from '../schema/galgame-workspace.js';

const PLANNER_RULES = `You are the Planner for a Ren'Py galgame production pipeline.
Your job: decide the next task to push the project toward a playable demo.

Rules:
1. You cannot generate assets yourself. To get work done, hand off to a POC with handoff_to_agent.
2. Known POC roles:
   producer, writer, storyboarder, character_designer, scene_designer,
   music_director, voice_director, sfx_designer, ui_designer, coder, qa.
3. A sensible Stage A order: producer (create project + chapter) -> character_designer(s)
   -> scene_designer(s) -> writer -> storyboarder -> coder -> qa.
4. Before acting, you may inspect workspace state with read_from_uri.
5. When all Stage A POCs have run and qa passes lint, check if Stage B is available.
6. Each turn: call exactly ONE tool_use. Read its result, then plan the next call.
7. You may use output_with_plan once at the start of a task to declare (in pseudo-code)
   what you intend to do; this is only for audit, the host does not parse it.
8. IDEMPOTENT RE-ENTRY: if the workspace index shows project + chapter + script + storyboard
   already exist AND prior memories include a finish with "Stage A delivered" / "no more tasks",
   you should call output_with_finish immediately with the same wording. Do NOT re-read every
   URI — trust the memory log. This saves a full LLM round-trip on rebuild.

Stage B (optional, runs after Stage A qa passes):
After Stage A qa passes lint, check the workspace index for "tier2Available: true".
If present, continue with Tier 2 POCs to add polish:
  - music_director: generate BGM tracks for scene moods
  - voice_director: generate voice lines for key dialogue
  - sfx_designer: generate ambient SFX for transitions
  - ui_designer: generate UI patches (title screen, textbox)
Stage B order: music_director -> sfx_designer -> voice_director -> ui_designer -> coder -> qa
After Stage B qa passes, call output_with_finish with taskSummary="Stage A+B delivered".
If tier2Available is false, finish with "Stage A delivered" after Stage A qa passes.
`;

// Modify-mode Planner rules (§5.5). Replaces PLANNER_RULES when the orchestrator
// invokes runPlannerTask({ mode: 'modify' }). Stays in the cacheable static
// segment so both generate-mode and modify-mode runs can hit prompt-cache.
const PLANNER_RULES_MODIFY = `You are the Planner for a Ren'Py galgame production pipeline, currently in MODIFY MODE.
The project already exists. A user has issued a **modify intent** (e.g. "change the protagonist to short hair").
Your job: translate that intent into the MINIMUM set of POC handoffs that realize it, then re-run coder + qa so the Ren'Py project stays playable.

Rules:
1. You cannot generate assets yourself. To get work done, hand off to a POC with handoff_to_agent.
2. Known POC roles: producer, writer, storyboarder, character_designer, scene_designer,
   music_director, voice_director, sfx_designer, ui_designer, coder, qa.
3. Before acting, inspect the current workspace with read_from_uri to understand what exists
   and which documents the intent touches. Unread guesses ship bugs.
4. MINIMUM-HANDOFF PRINCIPLE: only hand off to a POC when their owned document must change.
   Use the workspace schema's dependency relationships:
     - changing visualDescription on a character -> character_designer only (image regenerates
       via Stage B, storyboard/script reference by URI so nothing cascades)
     - changing one dialogue line -> writer (owns script) OR storyboarder (owns shot's
       dialogueLines[]); read both to find which one owns the target line before handing off
     - changing a scene location's look -> scene_designer only
     - adding a new character -> producer (if chapter.cast needs update) + character_designer
       (create character doc) + writer (splice a line or two so the character appears)
     - re-running coder and qa AT THE END after any content change so the .rpy project is
       rebuilt and linted.
5. OUT-OF-RANGE / UNRESOLVABLE: if the intent refers to something that doesn't exist
   (shot N with N > current count, a character not in the workspace, a scene slug that
   doesn't resolve), do NOT fabricate it. Call output_with_finish with a taskSummary that
   explicitly says what was missing (e.g. "cannot apply: shot 99 not found in current storyboard").
   The orchestrator will treat that as a graceful no-op.
6. Each turn: call exactly ONE tool_use. Read its result, then plan the next call.
7. output_with_plan is optional audit; the host does not parse it.
8. When coder + qa have re-run AND lint has passed (or the coder/qa cycle has converged),
   call output_with_finish with taskSummary="modify applied: <one-line description>".
   Do NOT use the generate-mode "Stage A delivered" wording — that signals full-pipeline done
   and will confuse idempotent re-entry checks on the next run.
9. IMPORTANT: even though prior memories may contain "Stage A delivered" from the initial
   generate run, you are NOT in generate mode. Ignore the idempotent-finish shortcut from
   generate-mode Rule 8; always execute the modify handoff(s) first.

Few-shot handoff patterns (mirror the minimum-handoff principle):

(A) Intent: "change character Baiying to have short hair"
    Turn 1: read_from_uri workspace://character/baiying    (confirm the character exists)
    Turn 2: handoff_to_agent character_designer
            brief: "Update visualDescription of workspace://character/baiying to a short-hair variant. Keep name/description intact. Clear mainImageUri so the main-image task-agent regenerates."
    Turn 3: handoff_to_agent coder
            brief: "Rebuild the .rpy project. Registry entry for Baiying's main image is now placeholder; re-swap on next ready notification."
    Turn 4: handoff_to_agent qa  (brief: "run_qa on rebuilt project")
    Turn 5: output_with_finish  taskSummary: "modify applied: Baiying visualDescription changed to short hair; main image reset to placeholder; coder rebuilt; qa ran."

(B) Intent: "change shot 3 line 0 dialogue to '...the tree is blooming.'"
    Turn 1: read_from_uri workspace://storyboard           (locate shot 3 line 0)
    Turn 2: handoff_to_agent storyboarder
            brief: "Update shot 3 dialogueLines[0].text to '...the tree is blooming.'. Do not touch other shots."
    Turn 3: handoff_to_agent coder + qa (same as above)
    Turn 4: output_with_finish  taskSummary: "modify applied: shot 3 line 0 dialogue updated; coder+qa re-ran."

(C) Intent: "add a barista character named Takeda and have him say one line"
    Turn 1: read_from_uri workspace://chapter              (see cast)
    Turn 2: handoff_to_agent producer                      (add Takeda to chapter.cast)
    Turn 3: handoff_to_agent character_designer            (create character/takeda doc)
    Turn 4: handoff_to_agent writer                        (splice a line from Takeda)
    Turn 5: handoff_to_agent storyboarder                  (re-condense so new line lands on a shot)
    Turn 6: handoff_to_agent coder + qa
    Turn 7: output_with_finish  taskSummary: "modify applied: added character Takeda; chapter cast, new character doc, one script line, and storyboard regenerated."

(D) Intent: "change shot 99 line 0 dialogue to 'X'" (shot 99 does not exist)
    Turn 1: read_from_uri workspace://storyboard
    Turn 2: output_with_finish
            taskSummary: "cannot apply: shot 99 not found in current storyboard (only N shots exist)."
`;

const PLANNER_POC_CAPABILITIES = `POC capability reference (for handoff_to_agent decisions):

- producer (tier 1)
    Owns: inspiration, project, chapter, route, ending.
    Tools: create_project, create_chapter.
    Invoke first, before anything else. Creates the skeleton (project.json +
    chapter.json) that later POCs reference via projectUri / chapterUri.

- character_designer (tier 1)
    Owns: character documents + their main-image / expression / dynamic-sprite
    placeholder entries in assetRegistry.
    Tools: create_or_update_character, generate_character_main_image (backed by
    character_prompt_expander + character_main_image_generator task agents),
    generate_character_expression, generate_character_dynamic_sprite.
    Invoke once per named character (protagonist + supporting cast). Stage A
    ships placeholders; Stage B regen runs automatically when visualDescription
    changes.

- scene_designer (tier 1)
    Owns: scene and prop documents plus their background / image placeholder
    registry entries.
    Tools: create_or_update_scene, generate_scene_background (scene_background_
    generator task agent), generate_prop, generate_scene_time_variant.
    Invoke once per location the writer / storyboarder will need. A scene is
    referenced by slug, so duplicating "bar-interior" and "lantern-bar-interior"
    is wasteful — consolidate when you see overlap in the brief.

- writer (tier 1)
    Owns: script.
    Tools: draft_script. Reads chapter + characters + scenes; emits a full
    SceneDialogueBlock[] with per-line speaker/emotion/direction. Do NOT invoke
    writer before characters and scenes exist — draft_script fails its
    validation gate otherwise.

- storyboarder (tier 1)
    Owns: storyboard and cutscene.
    Tools: condense_to_shots, generate_cutscene. Reads script, emits a
    Shot[] with enum-typed staging / transform / effects fields (ShotStaging /
    ShotTransform / ShotEffect in types.ts). Per-handoff soft limit is 2 calls
    of condense_to_shots — don't plan a third iteration; if the output is
    rough, kick back via Planner and re-handoff next turn.

- coder (tier 1)
    Owns: rpyFile, assetRegistry.
    Tools: write_game_project, swap_asset_placeholder. Reads storyboard +
    script + characters + scenes + registry; emits characters.rpy,
    options.rpy, script-chapter-XX.rpy plus gui/ and fonts. swap_asset_
    placeholder is used in Stage B to replace a placeholder with a real asset
    URI and mark the registry entry status="ready".

- qa (tier 1)
    Owns: testRun, bugReport.
    Tools: run_qa, kick_back_to_coder. run_qa invokes the local Ren'Py lint
    binary. HARD RULE: qa must read a minimum number of workspace docs via
    read_from_uri BEFORE run_qa — the Executer enforces a quota based on
    max(5, ceil(docCount / 2)). Under-reading will return error retry:false.
    If lint fails, kick_back_to_coder files a BugReport that Planner should
    read and then re-handoff coder.

- music_director (tier 2, Stage B)
    Owns: bgmTrack.
    Tools: generate_bgm_track. SunoV5 backend; chapter / route / scene scope.
    Use in Stage B when tier2Available is true.

- voice_director (tier 2, Stage B)
    Owns: voiceLine.
    Tools: generate_voice_line. One voiceLine per (script line, character).
    Qwen3 / Minimax backend. Use in Stage B when tier2Available is true.

- sfx_designer (tier 2, Stage B)
    Owns: sfx.
    Tools: generate_sfx. Per shot + cue (enter / action / exit / ambient).
    Use in Stage B when tier2Available is true.

- ui_designer (tier 2, Stage B)
    Owns: uiDesign.
    Tools: generate_ui_patch. Patches screens.rpy mood; buttons/backgrounds
    reuse scene/prop asset chain. Use in Stage B when tier2Available is true.

Tier-2 roles are for Stage B polish after Stage A qa passes. Only invoke them
when tier2Available is true in the workspace index.
`;

export const PLANNER_SYSTEM_PROMPT = [
  PLANNER_RULES,
  '---',
  'Workspace schema reference (for your planning decisions):',
  '',
  SCHEMA_DIGEST,
  '---',
  PLANNER_POC_CAPABILITIES,
].join('\n');

/**
 * Modify-mode static segment. Drops in as a replacement for PLANNER_SYSTEM_PROMPT
 * when runPlannerTask({ mode: 'modify' }) is used. Still a cacheable static block
 * (no per-run substitutions), so prompt-cache hits normally.
 */
export const PLANNER_SYSTEM_PROMPT_MODIFY = [
  PLANNER_RULES_MODIFY,
  '---',
  'Workspace schema reference (for your planning decisions):',
  '',
  SCHEMA_DIGEST,
  '---',
  PLANNER_POC_CAPABILITIES,
].join('\n');

export type PlannerMode = 'generate' | 'modify';

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
  /**
   * 'generate' (default): full-pipeline Stage A run with idempotent-finish
   * shortcut when prior memories indicate delivery.
   * 'modify': swap in the modify-mode static prompt + surface modifyIntent to
   * the Planner. See §5.5.4 step 2.
   */
  readonly mode?: PlannerMode;
  /** Required when `mode === 'modify'`: the user's modify intent in natural language. */
  readonly modifyIntent?: string;
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
  const mode: PlannerMode = params.mode ?? 'generate';
  if (mode === 'modify' && !params.modifyIntent) {
    throw new Error('runPlannerTask(mode=modify): modifyIntent is required');
  }

  const staticPrompt =
    mode === 'modify' ? PLANNER_SYSTEM_PROMPT_MODIFY : PLANNER_SYSTEM_PROMPT;

  // 分两段 system:第一段是 bytewise 恒定的 Planner 规则 + few-shot(适合 prompt cache),
  // 第二段是 storyName / workspace index / memories / modify intent(每轮都在变,不打 cache)。
  const dynamicSegment =
    mode === 'modify'
      ? buildPlannerDynamicSegmentModify(
          params.storyName,
          index,
          memories,
          params.modifyIntent ?? '',
        )
      : buildPlannerDynamicSegment(params.storyName, index, memories);

  const initialUserMessage =
    mode === 'modify'
      ? `Project "${params.storyName}". Apply this modify intent with the minimum set of POC handoffs, then rebuild via coder + qa:\n\n${params.modifyIntent}`
      : `Project "${params.storyName}". Decide the next task to push Stage A forward, or finish if no more tasks are needed.`;

  const messages: LlmToolMessage[] = [
    { role: 'system', content: staticPrompt, cacheControl: { type: 'ephemeral' } },
    { role: 'system', content: dynamicSegment },
    { role: 'user', content: initialUserMessage },
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

function buildPlannerDynamicSegmentModify(
  storyName: string,
  index: WorkspaceIndex,
  memories: ReadonlyArray<PlannerMemoryEntry>,
  modifyIntent: string,
): string {
  // Deliberately omit the idempotent-finish hint even if prior memories say
  // "Stage A delivered" — modify mode *must* act on the intent.
  return [
    `Project: ${storyName}`,
    '',
    'Mode: MODIFY (the Ren\'Py project already exists; apply the user intent below).',
    '',
    'User modify intent:',
    modifyIntent,
    '',
    'Current workspace index (the set of documents you can read / modify via handoffs):',
    index.formatForPrompt(),
    '',
    'Completed tasks (from planner_memories, include prior generate runs):',
    formatMemoriesForPrompt(memories),
  ].join('\n');
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
  return /no more tasks|stage a delivered|all tasks (complete|done)|^modify applied|^cannot apply/i.test(
    summary,
  );
}
