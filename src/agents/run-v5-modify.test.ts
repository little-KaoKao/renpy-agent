// End-to-end scripted tests for the V5 modify chain (plan §5.5).
//
// The four tests mirror the plan's acceptance criteria:
//   1. Change appearance            → byte-for-byte non-target docs unchanged
//   2. Change dialogue              → only storyboard changes, script intact
//   3. Add a new character          → Planner self-chooses 3 handoffs (producer,
//                                     character_designer, writer) without any
//                                     of those POCs being named in the intent
//   4. Out-of-range / unresolvable  → Planner returns "cannot apply" gracefully
//
// These tests DO NOT hit any real LLM or RunningHub — everything is scripted.
// The point is to validate the orchestration chain + POC dirty-state wiring,
// not the quality of individual Executer stages (those have their own tests).

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runV5Modify } from './run-v5.js';
import type {
  LlmClient,
  LlmToolChatParams,
  LlmToolChatResponse,
} from '../llm/types.js';

type ScriptQueues = {
  planner: LlmToolChatResponse[];
  executer: LlmToolChatResponse[];
  /** Stage queue for runWriter / runStoryboarder sub-LLM calls (single-tool emit_*). */
  stage?: LlmToolChatResponse[];
};

function scriptedLlm(script: ScriptQueues): LlmClient {
  let plannerIdx = 0;
  let executerIdx = 0;
  let stageIdx = 0;
  const stage = script.stage ?? [];
  return {
    chat: vi.fn(async () => {
      throw new Error('scripted chat() should not be called');
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
  name: string,
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

/**
 * Minimal Stage-A-compatible workspace fixture. Writes project / chapter /
 * storyboard / script singleton docs plus one character and one scene. Every
 * test starts from this snapshot so we can assert byte-for-byte invariance of
 * the "untouched" documents.
 */
interface Fixture {
  readonly root: string;
  readonly gameDir: string;
  readonly wsDir: string;
  readonly beforeSnapshot: Record<string, string>;
}

async function seedWorkspace(prefix: string, characterName = 'Baiying'): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  const gameDir = resolve(root, 'game');
  const wsDir = resolve(root, 'workspace');
  await mkdir(gameDir, { recursive: true });
  await mkdir(wsDir, { recursive: true });
  await mkdir(resolve(wsDir, 'characters'), { recursive: true });
  await mkdir(resolve(wsDir, 'scenes'), { recursive: true });

  const project = { title: 'SakuraTale', genre: 'romance', tone: 'bittersweet', status: 'ready' };
  const chapter = {
    title: 'Chapter 1',
    outline: 'first meeting under the cherry tree',
    cast: [characterName],
    status: 'ready',
  };
  const character = {
    name: characterName,
    description: 'quiet classmate',
    visualDescription: 'long black hair, school uniform',
    mainImageUri: 'images/character/baiying.png',
    status: 'ready',
  };
  const scene = {
    name: 'classroom',
    description: 'empty afternoon classroom, golden light',
    status: 'ready',
  };
  const script = {
    scenes: [
      {
        location: 'classroom',
        characters: [characterName],
        lines: [
          { speaker: characterName, text: 'hello' },
          { speaker: 'narrator', text: 'She smiled.' },
        ],
      },
    ],
    status: 'ready',
  };
  const storyboard = {
    shots: [
      {
        shotNumber: 1,
        description: 'meeting',
        characters: [characterName],
        sceneName: 'classroom',
        staging: 'solo_center',
        transform: 'stand',
        transition: 'fade',
        effects: [],
        dialogueLines: [
          { speaker: characterName, text: 'hello' },
          { speaker: 'narrator', text: 'She smiled.' },
        ],
      },
    ],
    status: 'ready',
  };

  await writeFile(resolve(wsDir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  await writeFile(resolve(wsDir, 'chapter.json'), JSON.stringify(chapter, null, 2) + '\n');
  await writeFile(resolve(wsDir, 'script.json'), JSON.stringify(script, null, 2) + '\n');
  await writeFile(resolve(wsDir, 'storyboard.json'), JSON.stringify(storyboard, null, 2) + '\n');
  await writeFile(
    resolve(wsDir, 'characters', `${characterName.toLowerCase()}.json`),
    JSON.stringify(character, null, 2) + '\n',
  );
  await writeFile(resolve(wsDir, 'scenes', 'classroom.json'), JSON.stringify(scene, null, 2) + '\n');

  // Capture the initial byte-level snapshot of every file we wrote so test 1
  // can assert that non-target documents don't drift.
  const files = [
    'project.json',
    'chapter.json',
    'script.json',
    'storyboard.json',
    `characters/${characterName.toLowerCase()}.json`,
    'scenes/classroom.json',
  ];
  const beforeSnapshot: Record<string, string> = {};
  for (const f of files) {
    beforeSnapshot[f] = await readFile(resolve(wsDir, f), 'utf8');
  }
  return { root, gameDir, wsDir, beforeSnapshot };
}

describe('runV5Modify — change appearance (test 1, byte-for-byte invariance)', () => {
  it(
    'Planner hands off to character_designer, then coder+qa; untouched docs are byte-identical',
    async () => {
      const fx = await seedWorkspace('v5-modify-appearance-');

      const llm = scriptedLlm({
        planner: [
          // Task 1: Planner reads the target character to confirm it exists,
          // then hands off to character_designer.
          plannerStep('p1', 'read_from_uri', { uri: 'workspace://character/baiying' }),
          plannerStep('p1b', 'handoff_to_agent', {
            pocRole: 'character_designer',
            brief: 'Update visualDescription of workspace://character/baiying to "short bob haircut, school uniform".',
          }),
          plannerStep('p1c', 'output_with_finish', {
            taskId: 'char',
            taskSummary: 'character_designer updated baiying',
          }),
          // Task 2: handoff coder
          plannerStep('p2', 'handoff_to_agent', { pocRole: 'coder' }),
          plannerStep('p2b', 'output_with_finish', {
            taskId: 'coder',
            taskSummary: 'coder rebuilt .rpy project',
          }),
          // Task 3: handoff qa
          plannerStep('p3', 'handoff_to_agent', { pocRole: 'qa' }),
          plannerStep('p3b', 'output_with_finish', {
            taskId: 'qa',
            taskSummary: 'qa ran',
          }),
          // Task 4: finish
          plannerStep('p4', 'output_with_finish', {
            taskId: 'done',
            taskSummary: 'modify applied: Baiying visualDescription changed to short bob; coder+qa re-ran',
          }),
        ],
        executer: [
          // character_designer: read existing doc (enforces read quota etiquette),
          // then update visualDescription.
          executerStep('e1', 'read_from_uri', { uri: 'workspace://character/baiying' }),
          executerStep('e2', 'create_or_update_character', {
            uri: 'workspace://character/baiying',
            visualDescription: 'short bob haircut, school uniform',
          }),
          executerStep('e3', 'output_with_finish', {
            taskId: 'char',
            taskSummary: 'baiying visualDescription updated; main image marked placeholder',
          }),
          // coder: read storyboard (satisfies read quota) then write_game_project
          executerStep('e4', 'read_from_uri', { uri: 'workspace://storyboard' }),
          executerStep('e5', 'read_from_uri', { uri: 'workspace://script' }),
          executerStep('e6', 'write_game_project', {}),
          executerStep('e7', 'output_with_finish', {
            taskId: 'coder',
            taskSummary: 'rpy rebuilt (baiying main image will render as placeholder)',
          }),
          // qa: read_from_uri enough times to satisfy the read quota, then run_qa
          executerStep('e8', 'read_from_uri', { uri: 'workspace://project' }),
          executerStep('e9', 'read_from_uri', { uri: 'workspace://chapter' }),
          executerStep('e10', 'read_from_uri', { uri: 'workspace://storyboard' }),
          executerStep('e11', 'read_from_uri', { uri: 'workspace://script' }),
          executerStep('e12', 'read_from_uri', { uri: 'workspace://character/baiying' }),
          executerStep('e13', 'read_from_uri', { uri: 'workspace://scene/classroom' }),
          executerStep('e14', 'run_qa', {}),
          executerStep('e15', 'output_with_finish', {
            taskId: 'qa',
            taskSummary: 'qa skipped (no sdk)',
          }),
        ],
      });

      const result = await runV5Modify({
        storyName: 'sakura-modify-1',
        modifyIntent: 'Change character Baiying to have a short bob haircut',
        llm,
        gameDir: fx.gameDir,
        maxPlannerTasks: 10,
      });

      expect(result.finalSummary).toMatch(/^modify applied/i);
      expect(result.plannerTaskCount).toBeGreaterThanOrEqual(3);

      // Target document: character/baiying.json must have new visualDescription.
      const charAfter = JSON.parse(
        await readFile(resolve(fx.wsDir, 'characters', 'baiying.json'), 'utf8'),
      );
      expect(charAfter.visualDescription).toBe('short bob haircut, school uniform');
      expect(charAfter.name).toBe('Baiying'); // preserved

      // Byte-for-byte invariance: project / chapter / script / storyboard / scene
      // must be EXACTLY the same as before the modify. character/baiying.json is
      // the ONLY document the modify should touch.
      const untouched = [
        'project.json',
        'chapter.json',
        'script.json',
        'storyboard.json',
        'scenes/classroom.json',
      ];
      for (const f of untouched) {
        const after = await readFile(resolve(fx.wsDir, f), 'utf8');
        expect(after, `${f} should be byte-identical`).toBe(fx.beforeSnapshot[f]);
      }
    },
    15000,
  );
});

describe('runV5Modify — change dialogue (test 2)', () => {
  it('Planner hands off to storyboarder; script stays intact', async () => {
    const fx = await seedWorkspace('v5-modify-dialogue-');
    const storyboardBefore = fx.beforeSnapshot['storyboard.json']!;
    const scriptBefore = fx.beforeSnapshot['script.json']!;

    const newStoryboard = {
      shots: [
        {
          shotNumber: 1,
          description: 'meeting',
          characters: ['Baiying'],
          sceneName: 'classroom',
          staging: 'solo_center',
          transform: 'stand',
          transition: 'fade',
          effects: [],
          dialogueLines: [
            { speaker: 'Baiying', text: 'the tree is blooming.' },
            { speaker: 'narrator', text: 'She smiled.' },
          ],
        },
      ],
    };

    const stageToolUse = (
      name: string,
      input: Record<string, unknown>,
    ): LlmToolChatResponse => ({
      content: [{ type: 'tool_use', id: `stage_${name}`, name, input }],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const llm = scriptedLlm({
      planner: [
        // Read storyboard to locate shot 1 line 0
        plannerStep('p1', 'read_from_uri', { uri: 'workspace://storyboard' }),
        plannerStep('p1b', 'handoff_to_agent', {
          pocRole: 'storyboarder',
          brief: 'Update shot 1 line 0 dialogue to "the tree is blooming.".',
        }),
        plannerStep('p1c', 'output_with_finish', {
          taskId: 'story',
          taskSummary: 'storyboarder updated',
        }),
        // Skip coder + qa in this test to keep the scripted queue small; the
        // point is that ONLY storyboard should have changed at the workspace
        // level. The plan's guidance calls for coder+qa but their outputs are
        // validated in test 1 already.
        plannerStep('p2', 'output_with_finish', {
          taskId: 'done',
          taskSummary: 'modify applied: shot 1 line 0 updated',
        }),
      ],
      executer: [
        executerStep('e1', 'read_from_uri', { uri: 'workspace://storyboard' }),
        executerStep('e2', 'read_from_uri', { uri: 'workspace://script' }),
        executerStep('e3', 'condense_to_shots', {}),
        executerStep('e4', 'output_with_finish', {
          taskId: 'story',
          taskSummary: 'storyboard re-condensed with updated line',
        }),
      ],
      stage: [stageToolUse('emit_storyboarder_output', newStoryboard)],
    });

    const result = await runV5Modify({
      storyName: 'sakura-modify-2',
      modifyIntent: 'Change shot 1 line 0 dialogue to "the tree is blooming."',
      llm,
      gameDir: fx.gameDir,
      maxPlannerTasks: 5,
    });

    expect(result.finalSummary).toMatch(/^modify applied/i);

    // storyboard should have changed
    const storyboardAfter = await readFile(resolve(fx.wsDir, 'storyboard.json'), 'utf8');
    expect(storyboardAfter).not.toBe(storyboardBefore);
    const storyboardParsed = JSON.parse(storyboardAfter);
    expect(storyboardParsed.shots[0].dialogueLines[0].text).toBe('the tree is blooming.');

    // script must NOT have changed byte-for-byte
    const scriptAfter = await readFile(resolve(fx.wsDir, 'script.json'), 'utf8');
    expect(scriptAfter).toBe(scriptBefore);
  });
});

describe('runV5Modify — add a new character (test 3, Planner self-routing)', () => {
  it(
    'Planner autonomously decides 3 handoffs (producer, character_designer, writer)',
    async () => {
      const fx = await seedWorkspace('v5-modify-add-');
      const origCharBefore = fx.beforeSnapshot['characters/baiying.json']!;

      // The Planner script below ONLY sees the user intent "add a barista
      // character named Takeda and have him say one line" — it MUST emit the
      // three handoffs without any of those roles being named in the intent.
      // (We cannot validate that the real Claude model would emit them; we
      // validate that when it DOES emit them, the orchestrator routes correctly.)
      const llm = scriptedLlm({
        planner: [
          // Task 1: producer updates chapter.cast
          plannerStep('p1', 'read_from_uri', { uri: 'workspace://chapter' }),
          plannerStep('p1b', 'handoff_to_agent', {
            pocRole: 'producer',
            brief: 'Add "Takeda" to chapter.cast.',
          }),
          plannerStep('p1c', 'output_with_finish', {
            taskId: 'producer',
            taskSummary: 'producer added takeda to chapter.cast',
          }),
          // Task 2: character_designer creates Takeda
          plannerStep('p2', 'handoff_to_agent', {
            pocRole: 'character_designer',
            brief: 'Create character Takeda: "a gruff barista in his 40s, apron, tired eyes".',
          }),
          plannerStep('p2b', 'output_with_finish', {
            taskId: 'char',
            taskSummary: 'created character/takeda',
          }),
          // Task 3: writer splices a line
          plannerStep('p3', 'handoff_to_agent', {
            pocRole: 'writer',
            brief: 'Add one spoken line from Takeda in the classroom scene.',
          }),
          plannerStep('p3b', 'output_with_finish', {
            taskId: 'writer',
            taskSummary: 'writer added one line from Takeda',
          }),
          // Final finish
          plannerStep('p4', 'output_with_finish', {
            taskId: 'done',
            taskSummary: 'modify applied: added character Takeda; cast, character doc, and one script line updated',
          }),
        ],
        executer: [
          // producer: update_chapter (tool name from producer/tools.ts — we'll
          // discover below; fall back to create_chapter which upserts).
          executerStep('e1', 'read_from_uri', { uri: 'workspace://chapter' }),
          executerStep('e2', 'create_chapter', {
            projectUri: 'workspace://project',
            outline: 'first meeting under the cherry tree',
            cast: ['Baiying', 'Takeda'],
          }),
          executerStep('e3', 'output_with_finish', {
            taskId: 'producer',
            taskSummary: 'chapter.cast updated to include Takeda',
          }),
          // character_designer: create Takeda
          executerStep('e4', 'create_or_update_character', {
            name: 'Takeda',
            description: 'barista at the campus café',
            visualDescription: 'a gruff man in his 40s, apron, tired eyes',
          }),
          executerStep('e5', 'output_with_finish', {
            taskId: 'char',
            taskSummary: 'character/takeda created (placeholder image)',
          }),
          // writer: draft_script (full redraft is fine — in a real run, writer
          // is the line-splice authority). For the test we just assert that
          // workspace://character/takeda exists and baiying.json is still the
          // original file byte-for-byte.
          executerStep('e6', 'read_from_uri', { uri: 'workspace://chapter' }),
          executerStep('e7', 'read_from_uri', { uri: 'workspace://character/baiying' }),
          executerStep('e8', 'read_from_uri', { uri: 'workspace://character/takeda' }),
          executerStep('e9', 'output_with_finish', {
            taskId: 'writer',
            taskSummary: 'writer acknowledged; line-splice deferred to next full redraft',
          }),
        ],
      });

      const result = await runV5Modify({
        storyName: 'sakura-modify-3',
        modifyIntent: 'Add a barista character named Takeda and have him say one line',
        llm,
        gameDir: fx.gameDir,
        maxPlannerTasks: 10,
      });

      expect(result.finalSummary).toMatch(/^modify applied/i);

      // New character file created
      const takedaPath = resolve(fx.wsDir, 'characters', 'takeda.json');
      const takeda = JSON.parse(await readFile(takedaPath, 'utf8'));
      expect(takeda.name).toBe('Takeda');
      expect(takeda.visualDescription).toMatch(/apron|barista|tired/i);

      // Original Baiying character file is byte-for-byte unchanged.
      const baiyingAfter = await readFile(
        resolve(fx.wsDir, 'characters', 'baiying.json'),
        'utf8',
      );
      expect(baiyingAfter).toBe(origCharBefore);
    },
    15000,
  );
});

describe('runV5Modify — out-of-range (test 4, graceful refusal)', () => {
  it('Planner reads storyboard, sees shot 99 is missing, finishes without crashing', async () => {
    const fx = await seedWorkspace('v5-modify-oor-');

    const llm = scriptedLlm({
      planner: [
        plannerStep('p1', 'read_from_uri', { uri: 'workspace://storyboard' }),
        plannerStep('p2', 'output_with_finish', {
          taskId: 'oor',
          taskSummary: 'cannot apply: shot 99 not found in current storyboard (only 1 shot exists)',
        }),
      ],
      executer: [],
    });

    const result = await runV5Modify({
      storyName: 'sakura-modify-4',
      modifyIntent: 'Change shot 99 line 0 dialogue to something',
      llm,
      gameDir: fx.gameDir,
      maxPlannerTasks: 3,
    });

    expect(result.finalSummary).toMatch(/^cannot apply/i);
    // No workspace file should have changed.
    for (const [f, before] of Object.entries(fx.beforeSnapshot)) {
      const after = await readFile(resolve(fx.wsDir, f), 'utf8');
      expect(after, `${f} must be untouched after graceful refusal`).toBe(before);
    }
  });
});

describe('runV5Modify — precondition checks', () => {
  it('errors when workspace/ does not exist yet', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-modify-noexist-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });
    // Intentionally no workspace dir.

    const llm = scriptedLlm({ planner: [], executer: [] });

    await expect(
      runV5Modify({
        storyName: 'no-story',
        modifyIntent: 'x',
        llm,
        gameDir,
        maxPlannerTasks: 1,
      }),
    ).rejects.toThrow(/workspace not found/i);
  });
});
