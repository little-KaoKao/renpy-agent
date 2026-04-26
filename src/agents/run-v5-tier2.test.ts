// End-to-end scripted tests for Tier 2 tool wiring. These go beyond
// tools.test.ts in that the Planner -> Executer -> tool chain is exercised
// through runV5, including ctx.runningHubClient / ctx.fetchFn injection.

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runV5 } from './run-v5.js';
import type {
  LlmClient,
  LlmToolChatResponse,
  LlmToolChatParams,
} from '../llm/types.js';
import type { RunningHubClient } from '../executers/common/runninghub-client.js';
import type { FetchLike } from '../assets/download.js';

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

function scriptedLlm(
  planner: LlmToolChatResponse[],
  executer: LlmToolChatResponse[],
): LlmClient {
  let pIdx = 0;
  let eIdx = 0;
  return {
    chat: vi.fn(async () => {
      throw new Error('scripted chat() should not be called');
    }),
    chatWithTools: vi.fn(async (params: LlmToolChatParams) => {
      const names = params.tools.map((t) => t.name);
      if (names.includes('handoff_to_agent')) {
        if (pIdx >= planner.length) {
          throw new Error(`planner exhausted (idx ${pIdx})`);
        }
        return planner[pIdx++]!;
      }
      if (eIdx >= executer.length) {
        throw new Error(`executer exhausted (idx ${eIdx})`);
      }
      return executer[eIdx++]!;
    }),
  };
}

function fakeRunningHubClient(outputUri: string): RunningHubClient {
  return {
    submitTask: vi.fn().mockResolvedValue({ taskId: 'fake' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri }),
  };
}

function fakeFetch(): FetchLike {
  return vi.fn(
    async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
  ) as unknown as FetchLike;
}

describe('runV5 Tier 2: character expression chain', () => {
  it('Planner → character_designer → generate_character_expression persists variant', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-tier2-expr-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });

    const planner: LlmToolChatResponse[] = [
      // Task 1: character_designer — create + generate expression
      plannerStep('p1', 'handoff_to_agent', { pocRole: 'character_designer' }),
      plannerStep('p1b', 'output_with_finish', {
        taskId: 'char',
        taskSummary: 'baiying ready + smile expression generated',
      }),
      plannerStep('p2', 'output_with_finish', {
        taskId: 'done',
        taskSummary: 'no more tasks, Stage A delivered',
      }),
    ];
    const executer: LlmToolChatResponse[] = [
      executerStep('e1', 'create_or_update_character', {
        name: 'Baiying',
        description: 'quiet classmate',
        visualDescription: 'long black hair, uniform',
        mainImageUri: 'images/char/baiying.png',
      }),
      executerStep('e2', 'generate_character_expression', {
        characterName: 'Baiying',
        expressionName: 'smile',
        expressionPrompt: 'smiling softly, eyes half-closed',
      }),
      executerStep('e3', 'output_with_finish', {
        taskId: 'char',
        taskSummary: 'baiying + smile expression ready',
      }),
    ];

    const llm = scriptedLlm(planner, executer);

    const result = await runV5({
      storyName: 'tier2-expr',
      inspiration: 'short test',
      llm,
      gameDir,
      runningHubClient: fakeRunningHubClient('https://cdn/smile.png'),
      fetchFn: fakeFetch(),
    });

    expect(result.finalSummary).toMatch(/no more tasks/i);
    const charDoc = JSON.parse(
      await readFile(
        resolve(gameDir, '..', 'workspace', 'characters', 'baiying.json'),
        'utf8',
      ),
    );
    expect(charDoc.mainImageUri).toBe('images/char/baiying.png');
    expect(charDoc.expressions).toHaveLength(1);
    expect(charDoc.expressions[0].expressionName).toBe('smile');
    expect(charDoc.expressions[0].imageUri).toBe('images/char/baiying__smile.png');

    // AssetRegistry should have an entry for the expression.
    const registry = JSON.parse(
      await readFile(resolve(gameDir, '..', 'asset-registry.json'), 'utf8'),
    );
    const keys = registry.entries.map((e: { logicalKey: string }) => e.logicalKey);
    expect(keys).toContain('character:baiying:expr:smile');
  }, 15000);
});

describe('runV5 Tier 2: BGM chain', () => {
  it('Planner → music_director → generate_bgm_track persists BgmTrack doc', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v5-tier2-bgm-'));
    const gameDir = resolve(root, 'game');
    await mkdir(gameDir, { recursive: true });

    const planner: LlmToolChatResponse[] = [
      plannerStep('p1', 'handoff_to_agent', { pocRole: 'music_director' }),
      plannerStep('p1b', 'output_with_finish', {
        taskId: 'music',
        taskSummary: 'opening bgm generated',
      }),
      plannerStep('p2', 'output_with_finish', {
        taskId: 'done',
        taskSummary: 'no more tasks, Stage A delivered',
      }),
    ];
    const executer: LlmToolChatResponse[] = [
      executerStep('e1', 'generate_bgm_track', {
        trackName: 'Opening Theme',
        moodTag: 'warm',
        styleDescription: 'soft piano, wistful strings, looping intro',
      }),
      executerStep('e2', 'output_with_finish', {
        taskId: 'music',
        taskSummary: 'opening theme ready',
      }),
    ];

    const llm = scriptedLlm(planner, executer);

    await runV5({
      storyName: 'tier2-bgm',
      inspiration: 'short test',
      llm,
      gameDir,
      runningHubClient: fakeRunningHubClient('https://cdn/opening.mp3'),
      fetchFn: fakeFetch(),
    });

    const bgm = JSON.parse(
      await readFile(
        resolve(gameDir, '..', 'workspace', 'bgm_tracks', 'opening_theme.json'),
        'utf8',
      ),
    );
    expect(bgm).toMatchObject({
      trackName: 'Opening Theme',
      moodTag: 'warm',
      status: 'ready',
    });
    expect(bgm.audioUri).toBe('audio/bgm/opening_theme.mp3');

    const registry = JSON.parse(
      await readFile(resolve(gameDir, '..', 'asset-registry.json'), 'utf8'),
    );
    const keys = registry.entries.map((e: { logicalKey: string }) => e.logicalKey);
    expect(keys).toContain('bgm:opening_theme');
  }, 15000);
});
