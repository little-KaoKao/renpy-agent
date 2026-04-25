import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LlmClient, LlmChatParams, LlmResponse } from '../llm/types.js';
import type {
  RunningHubClient,
  RunningHubSubmitParams,
} from '../executers/common/runninghub-client.js';
import { runPipeline, slugifyStoryName } from './run-pipeline.js';

const PLANNER_JSON = {
  projectTitle: 'Test Night',
  genre: 'romance',
  tone: 'tender',
  characters: [{ name: 'Hana', description: 'lead', visualDescription: 'pink hair' }],
  scenes: [{ name: 'garden', description: 'sakura garden' }],
  chapterOutline: 'a quiet confession',
};

const WRITER_JSON = {
  scenes: [
    {
      location: 'garden',
      characters: ['Hana'],
      lines: [{ speaker: 'Hana', text: 'hello' }],
    },
  ],
};

const STORYBOARDER_JSON = {
  shots: [
    {
      shotNumber: 1,
      description: 'open',
      characters: ['Hana'],
      sceneName: 'garden',
      staging: 'enter',
      transforms: 'stand',
      transition: 'fade',
      dialogueLines: [{ speaker: 'Hana', text: 'hello' }],
    },
  ],
};

class ScriptedLlm implements LlmClient {
  private readonly queue: string[];
  public readonly calls: LlmChatParams[] = [];

  constructor(queue: string[]) { this.queue = [...queue]; }

  async chat(params: LlmChatParams): Promise<LlmResponse> {
    this.calls.push(params);
    const next = this.queue.shift();
    if (next === undefined) throw new Error('ScriptedLlm ran out of canned responses');
    return { content: next, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

function wrapJson(obj: unknown): string {
  return '```json\n' + JSON.stringify(obj) + '\n```';
}

describe('runPipeline', () => {
  it('runs the full pipeline end-to-end with a scripted LLM and writes four .rpy files', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'renpy-pipe-'));
    try {
      // repoRoot has no renpy-sdk → QA will skip, not fail.
      // Planner's schema is loaded relative to planner.ts via import.meta.url, so it
      // transparently reads from the real src/schema — no setup needed in tmp.
      const llm = new ScriptedLlm([
        wrapJson(PLANNER_JSON),
        wrapJson(WRITER_JSON),
        wrapJson(STORYBOARDER_JSON),
      ]);

      const result = await runPipeline({
        inspiration: 'a cozy sakura confession',
        storyName: 'test-story',
        llm,
        repoRoot: tmp,
        logger: { info: () => {}, error: () => {} },
      });

      expect(result.storyName).toBe('test-story');
      expect(result.gamePath).toBe(resolve(tmp, 'runtime/games/test-story/game'));
      expect(result.testRun.result).toBe('skipped'); // no renpy-sdk in tmp
      expect(result.audioUi).toBeUndefined();

      const scriptRpy = await readFile(resolve(result.gamePath, 'script.rpy'), 'utf8');
      expect(scriptRpy).toContain('label start:');
      expect(scriptRpy).toContain('image bg_garden');
      expect(scriptRpy).not.toContain('play music');
      expect(scriptRpy).not.toContain('voice "');
      const optionsRpy = await readFile(resolve(result.gamePath, 'options.rpy'), 'utf8');
      expect(optionsRpy).toContain('define config.name = _("Test Night")');
      const screensRpy = await readFile(resolve(result.gamePath, 'screens.rpy'), 'utf8');
      expect(screensRpy).not.toContain('renpy-agent UI patch');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('runs the audio-ui stage when enableAudioUi=true, tolerating single failures', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'renpy-audioui-'));
    try {
      const UI_PATCH = [
        '# --- ui-patch: main_menu (mood: soft pastel visual-novel menu) ---',
        'screen main_menu():',
        '    tag menu',
        '    add Solid("#ffe7f0")',
      ].join('\n');
      const llm = new ScriptedLlm([
        wrapJson(PLANNER_JSON),
        wrapJson(WRITER_JSON),
        wrapJson(STORYBOARDER_JSON),
        UI_PATCH, // the 4th call is the UI designer (no JSON fence)
      ]);

      // One BGM per scene (1), voice lines up to 5 (we have 1 non-narrator line
      // so 1 call), zero SFX (no effects keyword match), 1 UI. RunningHub
      // should see 2 submit calls (BGM + Voice). Force the voice call to fail
      // so we can assert partial failure handling.
      const submit = vi.fn(async (p: RunningHubSubmitParams) => ({
        taskId: `${p.appKey}-task`,
      }));
      const pollTask = vi.fn(async (taskId: string) => {
        if (taskId.startsWith('VOICE_LINE')) {
          return { status: 'error' as const, errorMessage: 'voice failed' };
        }
        return { status: 'done' as const, outputUri: `https://cdn/${taskId}.mp3` };
      });
      const fetchFn = vi.fn(async () =>
        new Response(new Uint8Array([0x42]), { status: 200 }),
      );
      const runningHubClient: RunningHubClient = {
        submitTask: submit,
        pollTask,
      };

      // Patch global fetch so downloadAsset inside the executers can read our bytes.
      const realFetch = globalThis.fetch;
      globalThis.fetch = fetchFn as unknown as typeof fetch;
      try {
        const result = await runPipeline({
          inspiration: 'a cozy sakura confession',
          storyName: 'audioui-story',
          llm,
          repoRoot: tmp,
          logger: { info: () => {}, error: () => {} },
          enableAudioUi: true,
          runningHubClient,
        });

        expect(result.audioUi).toBeDefined();
        expect(result.audioUi!.bgm.ok).toBe(1);
        expect(result.audioUi!.bgm.err).toBe(0);
        // Voice was forced to fail.
        expect(result.audioUi!.voice.err).toBeGreaterThan(0);
        expect(result.audioUi!.ui.ok).toBe(1);

        expect(submit).toHaveBeenCalledWith(
          expect.objectContaining({ appKey: 'BGM_TRACK' }),
        );
        expect(submit).toHaveBeenCalledWith(
          expect.objectContaining({ appKey: 'VOICE_LINE' }),
        );

        const scriptRpy = await readFile(resolve(result.gamePath, 'script.rpy'), 'utf8');
        // BGM asset was downloaded and wired up
        expect(scriptRpy).toMatch(/play music "audio\/bgm\/garden\.mp3"/);
        // Voice line failed → no voice statement in script
        expect(scriptRpy).not.toContain('voice "');

        const screensRpy = await readFile(resolve(result.gamePath, 'screens.rpy'), 'utf8');
        expect(screensRpy).toContain('# === renpy-agent UI patch: main_menu ===');

        // Workspace JSON for each group was written.
        const bgmJson = JSON.parse(
          await readFile(resolve(result.gamePath, '../workspace/bgm.json'), 'utf8'),
        );
        expect(bgmJson.tracks).toHaveLength(1);
        const voiceJson = JSON.parse(
          await readFile(resolve(result.gamePath, '../workspace/voice.json'), 'utf8'),
        );
        expect(voiceJson.lines).toHaveLength(1);
        const uiJson = JSON.parse(
          await readFile(resolve(result.gamePath, '../workspace/ui.json'), 'utf8'),
        );
        expect(uiJson.patches).toHaveLength(1);
      } finally {
        globalThis.fetch = realFetch;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('saves stage snapshots incrementally so a later failure does not discard earlier work', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'renpy-inc-'));
    try {
      // Feed a bad storyboarder response twice so runStoryboarder exhausts retries.
      const llm = new ScriptedLlm([
        wrapJson(PLANNER_JSON),
        wrapJson(WRITER_JSON),
        '```json\n{ not valid json\n```',
        '```json\n{ still not valid\n```',
      ]);

      await expect(
        runPipeline({
          inspiration: 'x',
          storyName: 'inc-story',
          llm,
          repoRoot: tmp,
          logger: { info: () => {}, error: () => {} },
        }),
      ).rejects.toThrow();

      const workspaceDir = resolve(tmp, 'runtime/games/inc-story/workspace');
      const plannerJson = JSON.parse(await readFile(resolve(workspaceDir, 'planner.json'), 'utf8'));
      expect(plannerJson.projectTitle).toBe('Test Night');
      const writerJson = JSON.parse(await readFile(resolve(workspaceDir, 'writer.json'), 'utf8'));
      expect(writerJson.scenes).toHaveLength(1);
      // Storyboarder never succeeded → no storyboarder.json.
      await expect(readFile(resolve(workspaceDir, 'storyboarder.json'), 'utf8')).rejects.toThrow();
      // Raw response was dumped for diagnosis.
      const { readdir } = await import('node:fs/promises');
      const debugFiles = await readdir(resolve(workspaceDir, 'debug'));
      expect(debugFiles.some((f) => f.startsWith('storyboarder-raw-'))).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('resume=true skips stages whose snapshots already exist', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'renpy-resume-'));
    try {
      // First run: seed planner + writer snapshots via a failing storyboarder.
      const firstLlm = new ScriptedLlm([
        wrapJson(PLANNER_JSON),
        wrapJson(WRITER_JSON),
        '```json\n{ not json\n```',
        '```json\n{ not json\n```',
      ]);
      await expect(
        runPipeline({
          inspiration: 'x',
          storyName: 'resume-story',
          llm: firstLlm,
          repoRoot: tmp,
          logger: { info: () => {}, error: () => {} },
        }),
      ).rejects.toThrow();
      // planner + writer were called; storyboarder attempted twice (retry).
      expect(firstLlm.calls).toHaveLength(4);

      // Second run with resume=true: only storyboarder should be called.
      const secondLlm = new ScriptedLlm([wrapJson(STORYBOARDER_JSON)]);
      const result = await runPipeline({
        inspiration: 'x',
        storyName: 'resume-story',
        llm: secondLlm,
        repoRoot: tmp,
        logger: { info: () => {}, error: () => {} },
        resume: true,
      });
      expect(secondLlm.calls).toHaveLength(1);
      expect(result.planner.projectTitle).toBe('Test Night');
      expect(result.storyboarder.shots).toHaveLength(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('throws when enableAudioUi is set but runningHubClient is missing', async () => {
    const llm = new ScriptedLlm([wrapJson(PLANNER_JSON), wrapJson(WRITER_JSON), wrapJson(STORYBOARDER_JSON)]);
    await expect(
      runPipeline({
        inspiration: 'x',
        storyName: 'y',
        llm,
        logger: { info: () => {}, error: () => {} },
        enableAudioUi: true,
      }),
    ).rejects.toThrow(/requires runningHubClient/);
  });
});

describe('slugifyStoryName', () => {
  it('slugifies a user-provided name', () => {
    expect(slugifyStoryName('Sakura Night!')).toBe('sakura-night');
  });

  it('falls back to timestamp slug when name is empty', () => {
    const slug = slugifyStoryName(undefined, new Date(2026, 3, 22, 14, 30, 5));
    expect(slug).toBe('story-20260422-143005');
  });

  it('falls back to timestamp when slugifying yields nothing', () => {
    const slug = slugifyStoryName('!!!', new Date(2026, 3, 22, 14, 30, 5));
    expect(slug).toBe('story-20260422-143005');
  });
});
