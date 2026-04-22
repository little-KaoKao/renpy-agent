import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LlmClient, LlmChatParams, LlmResponse } from '../llm/types.js';
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

      const scriptRpy = await readFile(resolve(result.gamePath, 'script.rpy'), 'utf8');
      expect(scriptRpy).toContain('label start:');
      expect(scriptRpy).toContain('image bg_garden');
      const optionsRpy = await readFile(resolve(result.gamePath, 'options.rpy'), 'utf8');
      expect(optionsRpy).toContain('define config.name = _("Test Night")');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
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
