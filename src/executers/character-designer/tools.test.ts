import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { characterDesignerTools } from './tools.js';

async function makeCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-chardesigner-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('characterDesigner.create_or_update_character', () => {
  it('creates a new character with slug derived from name', async () => {
    const ctx = await makeCtx();
    const res = await characterDesignerTools.executors.create_or_update_character!(
      {
        name: 'Baiying',
        description: 'quiet classmate',
        visualDescription: 'long black hair, school uniform',
      },
      ctx,
    );
    expect(res).toMatchObject({
      uri: 'workspace://character/baiying',
      status: 'placeholder',
    });
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'characters', 'baiying.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({
      name: 'Baiying',
      visualDescription: 'long black hair, school uniform',
      status: 'placeholder',
    });
    expect(doc.mainImageUri ?? null).toBeNull();
  });

  it('updates an existing character by URI, keeping mainImageUri intact', async () => {
    const ctx = await makeCtx();
    await characterDesignerTools.executors.create_or_update_character!(
      {
        name: 'Baiying',
        description: 'd1',
        visualDescription: 'v1',
        mainImageUri: 'images/characters/baiying.png',
      },
      ctx,
    );

    const res = await characterDesignerTools.executors.create_or_update_character!(
      {
        uri: 'workspace://character/baiying',
        visualDescription: 'v2',
      },
      ctx,
    );
    expect(res).toMatchObject({ uri: 'workspace://character/baiying' });
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'characters', 'baiying.json'),
        'utf8',
      ),
    );
    expect(doc.visualDescription).toBe('v2');
    expect(doc.mainImageUri).toBe('images/characters/baiying.png');
    expect(doc.status).toBe('ready');
  });

  it('setting mainImageUri: null resets status to placeholder (cascade invalidation)', async () => {
    const ctx = await makeCtx();
    await characterDesignerTools.executors.create_or_update_character!(
      {
        name: 'Baiying',
        description: 'd',
        visualDescription: 'v',
        mainImageUri: 'images/characters/baiying.png',
      },
      ctx,
    );
    const res = await characterDesignerTools.executors.create_or_update_character!(
      {
        uri: 'workspace://character/baiying',
        mainImageUri: null,
      },
      ctx,
    );
    expect(res).toMatchObject({ status: 'placeholder' });
  });

  it('errors when neither uri nor name is provided', async () => {
    const ctx = await makeCtx();
    const res = await characterDesignerTools.executors.create_or_update_character!(
      { visualDescription: 'v' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/uri or name/i) });
  });
});

describe('characterDesigner.generate_character_main_image (v0.6 stub)', () => {
  it('returns error pointing to character_main_image_generator task agent', async () => {
    const ctx = await makeCtx();
    const res = await characterDesignerTools.executors.generate_character_main_image!(
      { characterUri: 'workspace://character/baiying' },
      ctx,
    );
    // v0.6 keeps this as a high-level orchestration tool; in the first
    // pass the Executer is expected to call the task agent directly. The
    // tool itself exists so the Planner sees the affordance in toolNames.
    expect(res).toMatchObject({
      error: expect.stringMatching(/call_task_agent/i),
    });
  });
});

describe('characterDesigner.schemas', () => {
  it('declares Tier-1 tools and Tier-2 stubs', () => {
    const names = characterDesignerTools.schemas.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'create_or_update_character',
        'generate_character_main_image',
        'generate_character_expression',
        'generate_character_dynamic_sprite',
      ]),
    );
  });
});
