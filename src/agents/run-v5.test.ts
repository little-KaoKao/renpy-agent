import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runV5 } from './run-v5.js';
import type { LlmClient, LlmToolChatResponse, LlmToolChatParams } from '../llm/types.js';

/**
 * Scripted LLM that produces deterministic responses.
 *
 * Routing:
 * - If tool list contains `handoff_to_agent` → planner queue
 * - If tool list contains exactly one `emit_*` tool (Writer / Storyboarder pipeline
 *   stages reached via draft_script / condense_to_shots) → stage queue
 * - Otherwise → executer queue
 */
function scriptedLlm(script: {
  planner: LlmToolChatResponse[];
  executer: LlmToolChatResponse[];
  stage?: LlmToolChatResponse[]; // for runWriter / runStoryboarder tool_use calls
}): LlmClient {
  let plannerIdx = 0;
  let executerIdx = 0;
  let stageIdx = 0;
  const stage = script.stage ?? [];

  return {
    chat: vi.fn(async () => {
      throw new Error('scripted chat() should not be called; pipeline stages use chatWithTools');
    }),
    chatWithTools: vi.fn(async (params: LlmToolChatParams) => {
      const names = params.tools.map((t) => t.name);
      if (names.includes('handoff_to_agent')) {
        if (plannerIdx >= script.planner.length) {
          throw new Error(`scripted planner exhausted (idx ${plannerIdx})`);
        }
        return script.planner[plannerIdx++]!;
      }
      if (names.length === 1 && names[0]!.startsWith('emit_')) {
        if (stageIdx >= stage.length) {
          throw new Error(`scripted stage exhausted (idx ${stageIdx}, tool=${names[0]})`);
        }
        return stage[stageIdx++]!;
      }
      if (executerIdx >= script.executer.length) {
        throw new Error(`scripted executer exhausted (idx ${executerIdx})`);
      }
      return script.executer[executerIdx++]!;
    }),
  };
}

function plannerStep(
  id: string,
  name: 'handoff_to_agent' | 'output_with_finish',
  input: Record<string, unknown>,
): LlmToolChatResponse {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function executerStep(
  id: string,
  name: string,
  input: Record<string, unknown>,
): LlmToolChatResponse {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe('runV5 — end-to-end scripted happy path', () => {
  it('runs the full 7-task sequence and produces a Stage A .rpy project', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-e2e-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });

    const writerInput = {
      scenes: [
        {
          location: 'classroom',
          characters: ['Baiying'],
          lines: [
            { speaker: 'Baiying', text: 'hello' },
            { speaker: 'narrator', text: 'She smiled.' },
          ],
        },
      ],
    };
    const storyboardInput = {
      shots: [
        {
          shotNumber: 1,
          description: 'meeting',
          characters: ['Baiying'],
          sceneName: 'classroom',
          staging: 'mid',
          transforms: 'none',
          transition: 'fade',
          dialogueLines: [
            { speaker: 'Baiying', text: 'hello' },
            { speaker: 'narrator', text: 'She smiled.' },
          ],
        },
      ],
    };
    const stageToolUse = (name: string, input: Record<string, unknown>): LlmToolChatResponse => ({
      content: [{ type: 'tool_use', id: `stage_${name}`, name, input }],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const llm = scriptedLlm({
      planner: [
        // Task 1: producer
        plannerStep('p1', 'handoff_to_agent', { pocRole: 'producer' }),
        plannerStep('p1b', 'output_with_finish', {
          taskId: 'producer',
          taskSummary: 'project + chapter created',
        }),
        // Task 2: character_designer
        plannerStep('p2', 'handoff_to_agent', { pocRole: 'character_designer' }),
        plannerStep('p2b', 'output_with_finish', {
          taskId: 'character',
          taskSummary: 'baiying character created',
        }),
        // Task 3: scene_designer
        plannerStep('p3', 'handoff_to_agent', { pocRole: 'scene_designer' }),
        plannerStep('p3b', 'output_with_finish', {
          taskId: 'scene',
          taskSummary: 'classroom scene created',
        }),
        // Task 4: writer
        plannerStep('p4', 'handoff_to_agent', { pocRole: 'writer' }),
        plannerStep('p4b', 'output_with_finish', {
          taskId: 'writer',
          taskSummary: 'script drafted',
        }),
        // Task 5: storyboarder
        plannerStep('p5', 'handoff_to_agent', { pocRole: 'storyboarder' }),
        plannerStep('p5b', 'output_with_finish', {
          taskId: 'storyboarder',
          taskSummary: 'shots condensed',
        }),
        // Task 6: coder
        plannerStep('p6', 'handoff_to_agent', { pocRole: 'coder' }),
        plannerStep('p6b', 'output_with_finish', {
          taskId: 'coder',
          taskSummary: 'rpy project written',
        }),
        // Task 7: qa
        plannerStep('p7', 'handoff_to_agent', { pocRole: 'qa' }),
        plannerStep('p7b', 'output_with_finish', {
          taskId: 'qa',
          taskSummary: 'qa run complete',
        }),
        // Task 8: done
        plannerStep('p8', 'output_with_finish', {
          taskId: 'done',
          taskSummary: 'no more tasks, Stage A delivered',
        }),
      ],
      executer: [
        // Producer: create_project + create_chapter + finish
        executerStep('e1', 'create_project', { title: 'SakuraTale', genre: 'romance', tone: 'bittersweet' }),
        executerStep('e2', 'create_chapter', {
          projectUri: 'workspace://project',
          outline: 'Chapter 1: first meeting under the cherry tree',
        }),
        executerStep('e3', 'output_with_finish', {
          taskId: 'producer',
          taskSummary: 'producer done',
        }),
        // Character designer: create character + finish
        executerStep('e4', 'create_or_update_character', {
          name: 'Baiying',
          description: 'quiet classmate',
          visualDescription: 'long hair, uniform',
        }),
        executerStep('e5', 'output_with_finish', {
          taskId: 'character',
          taskSummary: 'baiying created (placeholder image)',
        }),
        // Scene designer: create scene + finish
        executerStep('e6', 'create_or_update_scene', {
          name: 'classroom',
          description: 'empty afternoon classroom',
        }),
        executerStep('e7', 'output_with_finish', {
          taskId: 'scene',
          taskSummary: 'classroom created (placeholder bg)',
        }),
        // Writer: draft_script + finish
        executerStep('e8', 'draft_script', {
          chapterUri: 'workspace://chapter',
          characterUris: ['workspace://character/baiying'],
          sceneUris: ['workspace://scene/classroom'],
        }),
        executerStep('e9', 'output_with_finish', {
          taskId: 'writer',
          taskSummary: 'script drafted',
        }),
        // Storyboarder: condense_to_shots + finish
        executerStep('e10', 'condense_to_shots', {}),
        executerStep('e11', 'output_with_finish', {
          taskId: 'storyboarder',
          taskSummary: 'shots ready',
        }),
        // Coder: write_game_project + finish
        executerStep('e12', 'write_game_project', {}),
        executerStep('e13', 'output_with_finish', {
          taskId: 'coder',
          taskSummary: 'rpy written',
        }),
        // QA: run_qa + finish
        executerStep('e14', 'run_qa', {}),
        executerStep('e15', 'output_with_finish', {
          taskId: 'qa',
          taskSummary: 'qa done (skipped, no sdk)',
        }),
      ],
      stage: [
        // runWriter call (from draft_script)
        stageToolUse('emit_writer_output', writerInput),
        // runStoryboarder call (from condense_to_shots)
        stageToolUse('emit_storyboarder_output', storyboardInput),
      ],
    });

    const result = await runV5({
      storyName: 'sakura-e2e',
      inspiration: 'a short vignette about meeting under cherry blossoms',
      llm,
      gameDir,
    });

    expect(result.finalSummary).toMatch(/no more tasks|stage a delivered/i);
    expect(result.plannerTaskCount).toBeGreaterThanOrEqual(7);

    // Verify the Stage A .rpy files landed
    const gameFiles = await readdir(gameDir);
    expect(gameFiles).toEqual(
      expect.arrayContaining(['script.rpy', 'options.rpy', 'gui.rpy', 'screens.rpy']),
    );

    // Verify per-URI workspace docs were written
    const wsDir = resolve(gameDir, '..', 'workspace');
    const projectDoc = JSON.parse(await readFile(resolve(wsDir, 'project.json'), 'utf8'));
    expect(projectDoc.title).toBe('SakuraTale');

    const charFiles = await readdir(resolve(wsDir, 'characters'));
    expect(charFiles).toContain('baiying.json');

    // Verify planner_memories captured task summaries
    const memPath = resolve(gameDir, '..', 'planner_memories', 'log.jsonl');
    const mem = await readFile(memPath, 'utf8');
    expect(mem).toContain('no more tasks');
    expect(mem).toContain('rpy written');
  }, 15000);
});
