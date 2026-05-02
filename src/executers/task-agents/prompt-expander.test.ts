import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { characterPromptExpander } from './prompt-expander.js';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { LlmClient, LlmResponse } from '../../llm/types.js';

async function makeCtx(overrides: Partial<CommonToolContext> = {}): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-expander-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 'test',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

function scriptedLlm(response: string): LlmClient {
  return {
    chat: vi.fn(async (): Promise<LlmResponse> => ({
      content: response,
      usage: { inputTokens: 100, outputTokens: 80 },
    })),
  };
}

describe('characterPromptExpander', () => {
  it('happy path: parses {"prompt": "..."} JSON from LLM and returns expanded prompt', async () => {
    const llm = scriptedLlm('{"prompt": "a cheerful pink-haired maiden in school uniform, soft smile, gentle breeze, cel-shaded anime style, full body reference sheet, neutral background"}');
    const ctx = await makeCtx({ llm });
    const out = await characterPromptExpander(
      { visualDescription: '粉色头发的少女' },
      ctx,
    );
    expect(out).toMatchObject({
      prompt: expect.stringContaining('pink-haired'),
    });
    expect((out as { prompt: string }).prompt).not.toContain('```');
    expect(llm.chat).toHaveBeenCalled();
  });

  it('error path: missing visualDescription AND characterUri returns error', async () => {
    const ctx = await makeCtx({ llm: scriptedLlm('{}') });
    const out = await characterPromptExpander({}, ctx);
    expect(out).toMatchObject({
      error: expect.stringMatching(/visualDescription|characterUri/),
    });
  });

  it('error path: characterUri without visualDescription in doc returns error', async () => {
    const ctx = await makeCtx({ llm: scriptedLlm('{"prompt": "x"}') });
    const wsDir = resolve(ctx.gameDir, '..', 'workspace', 'characters');
    await mkdir(wsDir, { recursive: true });
    await writeFile(
      resolve(wsDir, 'mary.json'),
      JSON.stringify({ name: 'Mary' }),
    );
    const out = await characterPromptExpander(
      { characterUri: 'workspace://character/mary' },
      ctx,
    );
    expect(out).toMatchObject({
      error: expect.stringMatching(/visualDescription/),
    });
  });

  it('DRY_RUN: returns mock prompt without calling LLM', async () => {
    const llm = scriptedLlm('{"prompt": "should not be called"}');
    const ctx = await makeCtx({ llm });
    const out = await characterPromptExpander(
      { visualDescription: '长发少女', DRY_RUN: true },
      ctx,
    );
    expect(llm.chat).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      prompt: expect.stringContaining('[DRY_RUN]'),
      dryRun: true,
    });
  });
});
