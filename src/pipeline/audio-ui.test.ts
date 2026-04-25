import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LlmChatParams, LlmClient, LlmResponse } from '../llm/types.js';
import type {
  RunningHubClient,
  RunningHubSubmitParams,
  RunningHubTaskResult,
} from '../executers/common/runninghub-client.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';
import { runAudioUiStage } from './audio-ui.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'Sakura Night',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: 'Hana', description: 'lead', visualDescription: 'pink hair' },
    { name: 'Kai', description: 'co-lead', visualDescription: 'black hair' },
  ],
  scenes: [
    { name: 'garden', description: 'moonlit sakura garden' },
    { name: 'corridor', description: 'empty school hallway' },
  ],
  chapterOutline: 'a quiet confession',
};

const WRITER: WriterOutput = {
  scenes: [
    {
      location: 'garden',
      characters: ['Hana', 'Kai'],
      lines: [
        { speaker: 'narrator', text: 'The wind hushes.' },
        { speaker: 'Hana', text: 'Can you hear me?' },
        { speaker: 'Kai', text: 'Yes.' },
        { speaker: 'Hana', text: 'Stay a little longer.' },
      ],
    },
  ],
};

const STORYBOARDER: StoryboarderOutput = {
  shots: [
    {
      shotNumber: 1,
      description: 'open with wind through trees',
      characters: ['Hana'],
      sceneName: 'garden',
      staging: 'enter',
      transforms: 'stand',
      transition: 'fade',
      effects: 'gentle wind through the branches',
      dialogueLines: [{ speaker: 'Hana', text: 'Can you hear me?' }],
    },
    {
      shotNumber: 2,
      description: 'no sfx keyword here',
      characters: ['Hana'],
      sceneName: 'garden',
      staging: 'enter',
      transforms: 'stand',
      transition: 'none',
      effects: 'petals drift across the frame',
      dialogueLines: [{ speaker: 'Hana', text: 'Stay.' }],
    },
  ],
};

class ScriptedLlm implements LlmClient {
  public readonly calls: LlmChatParams[] = [];
  private readonly queue: string[];
  constructor(queue: string[]) { this.queue = [...queue]; }
  async chat(params: LlmChatParams): Promise<LlmResponse> {
    this.calls.push(params);
    const next = this.queue.shift();
    if (next === undefined) throw new Error('ScriptedLlm exhausted');
    return { content: next, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

function makeRunningHub(options: {
  voiceFail?: boolean;
  bgmFail?: boolean;
  sfxFail?: boolean;
} = {}): RunningHubClient & {
  submit: ReturnType<typeof vi.fn>;
  poll: ReturnType<typeof vi.fn>;
} {
  const submit = vi.fn(async (p: RunningHubSubmitParams) => ({
    taskId: `${p.appKey}-task`,
  }));
  const poll = vi.fn(async (taskId: string): Promise<RunningHubTaskResult> => {
    if (options.bgmFail && taskId.startsWith('BGM_TRACK')) {
      return { status: 'error', errorMessage: 'bgm boom' };
    }
    if (options.voiceFail && taskId.startsWith('VOICE_LINE')) {
      return { status: 'error', errorMessage: 'voice boom' };
    }
    if (options.sfxFail && taskId.startsWith('SFX')) {
      return { status: 'error', errorMessage: 'sfx boom' };
    }
    return { status: 'done', outputUri: `https://cdn/${taskId}.mp3` };
  });
  return { submitTask: submit, pollTask: poll, submit, poll } as any;
}

const fakeFetch = (async () =>
  new Response(new Uint8Array([0x42]), { status: 200 })) as unknown as typeof fetch;

describe('runAudioUiStage', () => {
  let gameDir: string;
  let registryPath: string;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'renpy-audioui-unit-'));
    gameDir = resolve(tmp, 'game');
    registryPath = resolve(tmp, 'asset-registry.json');
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('plans BGM per scene, voice for non-narrator lines, SFX only for keyword matches, and one UI patch', async () => {
    const llm = new ScriptedLlm([
      'screen main_menu():\n    tag menu\n    add Solid("#eee")',
    ]);
    const client = makeRunningHub();
    const result = await runAudioUiStage({
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
      gameDir,
      registryPath,
      runningHubClient: client,
      llm,
      pollIntervalMs: 0,
      sleep: async () => {},
      fetchFn: fakeFetch,
    });

    expect(result.bgm.tracks).toHaveLength(2);
    expect(result.bgm.tracks.map((t) => t.sceneName)).toEqual(['garden', 'corridor']);

    // Writer scene[0] has 4 lines, 1 narrator-skipped → 3 voice plan entries
    // (budget is 5 so all 3 survive).
    expect(result.voice.lines).toHaveLength(3);
    expect(result.voice.lines.every((l) => l.speaker !== 'narrator')).toBe(true);

    // Only shot #1 has 'wind' in effects → 1 sfx cue.
    expect(result.sfx.cues).toHaveLength(1);
    expect(result.sfx.cues[0]).toMatchObject({ shotNumber: 1, cue: 'enter' });

    expect(result.ui.patches).toHaveLength(1);
    expect(result.ui.patches[0]!.screen).toBe('main_menu');
    expect(result.ui.patches[0]!.rpyScreenPatch).toContain('screen main_menu');

    // Everything succeeded.
    expect(result.stats).toEqual({
      bgm: { ok: 2, err: 0 },
      voice: { ok: 3, err: 0 },
      sfx: { ok: 1, err: 0 },
      ui: { ok: 1, err: 0 },
    });
  });

  it('tolerates a single failing group without collapsing the stage', async () => {
    const llm = new ScriptedLlm([
      'screen main_menu():\n    tag menu\n    add Solid("#eee")',
    ]);
    const client = makeRunningHub({ voiceFail: true });
    const errorLog: string[] = [];
    const result = await runAudioUiStage({
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
      gameDir,
      registryPath,
      runningHubClient: client,
      llm,
      logger: { info: () => {}, error: (msg) => { errorLog.push(msg); } },
      pollIntervalMs: 0,
      sleep: async () => {},
      fetchFn: fakeFetch,
    });
    expect(result.stats.bgm).toEqual({ ok: 2, err: 0 });
    expect(result.stats.voice.err).toBe(3);
    expect(result.stats.voice.ok).toBe(0);
    expect(result.stats.sfx).toEqual({ ok: 1, err: 0 });
    expect(result.stats.ui).toEqual({ ok: 1, err: 0 });
    expect(errorLog.some((m) => m.includes('voice failed for scene_1'))).toBe(true);
  });

  it('respects a 5-line voice budget even when the writer scene has more lines', async () => {
    const llm = new ScriptedLlm(['screen main_menu():\n    tag menu']);
    const longScene: WriterOutput = {
      scenes: [
        {
          location: 'garden',
          characters: ['Hana'],
          lines: Array.from({ length: 12 }, (_, i) => ({
            speaker: 'Hana',
            text: `line ${i}`,
          })),
        },
      ],
    };
    const client = makeRunningHub();
    const errLog: string[] = [];
    const result = await runAudioUiStage({
      planner: PLANNER,
      writer: longScene,
      storyboarder: STORYBOARDER,
      gameDir,
      registryPath,
      runningHubClient: client,
      llm,
      logger: { info: () => {}, error: (m) => errLog.push(m) },
      pollIntervalMs: 0,
      sleep: async () => {},
      fetchFn: fakeFetch,
    });
    expect(result.voice.lines).toHaveLength(5);
    expect(result.stats.voice).toEqual({ ok: 5, err: 0 });
    expect(errLog).toEqual([]);
  });

  it('produces empty voice/sfx plans without calling RunningHub when there is nothing to do', async () => {
    const llm = new ScriptedLlm(['screen main_menu():\n    tag menu']);
    const emptyWriter: WriterOutput = {
      scenes: [{ location: 'garden', characters: [], lines: [] }],
    };
    const boringBoard: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 1,
          description: 'quiet',
          characters: [],
          sceneName: 'garden',
          staging: 'enter',
          transforms: 'stand',
          transition: 'none',
          dialogueLines: [],
        },
      ],
    };
    const client = makeRunningHub();
    const result = await runAudioUiStage({
      planner: PLANNER,
      writer: emptyWriter,
      storyboarder: boringBoard,
      gameDir,
      registryPath,
      runningHubClient: client,
      llm,
      pollIntervalMs: 0,
      sleep: async () => {},
      fetchFn: fakeFetch,
    });
    expect(result.voice.lines).toEqual([]);
    expect(result.sfx.cues).toEqual([]);
    expect(result.stats.voice).toEqual({ ok: 0, err: 0 });
    expect(result.stats.sfx).toEqual({ ok: 0, err: 0 });
    // Only BGM submissions should touch RunningHub (1 per scene = 2).
    const submit = (client as any).submit as ReturnType<typeof vi.fn>;
    const voiceOrSfxCalls = submit.mock.calls.filter(
      ([p]: [RunningHubSubmitParams]) => p.appKey === 'VOICE_LINE' || p.appKey === 'SFX',
    );
    expect(voiceOrSfxCalls).toHaveLength(0);
  });
});
