import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { characterDesignerTools } from './tools.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';

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

  // Regression guard for M6 smoke (2026-05-02): see the matching regression
  // test in scene-designer/tools.test.ts. Compact deterministic ack only —
  // no echoed doc — so duplicate upserts return byte-identical results.
  it('returns compact ack + byte-identical on duplicate upsert', async () => {
    const ctx = await makeCtx();
    const first = await characterDesignerTools.executors.create_or_update_character!(
      { name: 'Baiying', description: 'd', visualDescription: 'v' },
      ctx,
    );
    expect(first).toEqual({
      uri: 'workspace://character/baiying',
      status: 'placeholder',
      saved: true,
    });
    const second = await characterDesignerTools.executors.create_or_update_character!(
      { name: 'Baiying', description: 'd', visualDescription: 'v' },
      ctx,
    );
    expect(second).toEqual(first);
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

async function makeCtxWithClient(overrides: Partial<RunningHubClient> = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-chardesigner-tier2-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  const client: RunningHubClient = {
    submitTask: vi.fn().mockResolvedValue({ taskId: 't1' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/out.png' }),
    ...overrides,
  };
  const fetchFn: FetchLike = vi.fn(
    async () => new Response(new Uint8Array([1, 2]), { status: 200 }),
  ) as unknown as FetchLike;
  return {
    storyName: 's',
    gameDir,
    workspaceDir: resolve(root, 'workspace'),
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runningHubClient: client,
    fetchFn,
  } satisfies CommonToolContext;
}

describe('characterDesigner.generate_character_expression', () => {
  it('errors without mainImageUri', async () => {
    const ctx = await makeCtxWithClient();
    await writeWorkspaceDoc('workspace://character/baiying', ctx.gameDir, {
      name: 'Baiying',
      description: 'd',
      visualDescription: 'vd',
      mainImageUri: null,
      status: 'placeholder',
    });
    const res = await characterDesignerTools.executors.generate_character_expression!(
      {
        characterUri: 'workspace://character/baiying',
        expressionName: 'smile',
        expressionPrompt: 'smiling softly',
      },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/mainImageUri/) });
  });

  it('errors when character not found', async () => {
    const ctx = await makeCtxWithClient();
    const res = await characterDesignerTools.executors.generate_character_expression!(
      {
        characterName: 'Unknown',
        expressionName: 'smile',
        expressionPrompt: 'smile',
      },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/character not found/) });
  });

  it('appends expression variant and updates character doc', async () => {
    const ctx = await makeCtxWithClient({
      pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/smile.png' }),
    });
    await writeWorkspaceDoc('workspace://character/baiying', ctx.gameDir, {
      name: 'Baiying',
      description: 'd',
      visualDescription: 'vd',
      mainImageUri: 'images/char/baiying.png',
      status: 'ready',
    });
    const res = (await characterDesignerTools.executors.generate_character_expression!(
      {
        characterName: 'Baiying',
        expressionName: 'smile',
        expressionPrompt: 'smiling softly',
      },
      ctx,
    )) as { uri: string; expressionName: string; imageUri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.expressionName).toBe('smile');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'characters', 'baiying.json'),
        'utf8',
      ),
    );
    expect(doc.expressions).toHaveLength(1);
    expect(doc.expressions[0]).toMatchObject({ expressionName: 'smile' });
  });
});

describe('characterDesigner.generate_character_dynamic_sprite', () => {
  it('errors without mainImageUri', async () => {
    const ctx = await makeCtxWithClient();
    await writeWorkspaceDoc('workspace://character/baiying', ctx.gameDir, {
      name: 'Baiying',
      description: 'd',
      visualDescription: 'vd',
      mainImageUri: null,
      status: 'placeholder',
    });
    const res = await characterDesignerTools.executors.generate_character_dynamic_sprite!(
      { characterName: 'Baiying' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/mainImageUri/) });
  });

  it('writes dynamicSpriteUri onto character doc', async () => {
    const ctx = await makeCtxWithClient({
      pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/dyn.mp4' }),
    });
    await writeWorkspaceDoc('workspace://character/baiying', ctx.gameDir, {
      name: 'Baiying',
      description: 'd',
      visualDescription: 'vd',
      mainImageUri: 'images/char/baiying.png',
      status: 'ready',
    });
    const res = (await characterDesignerTools.executors.generate_character_dynamic_sprite!(
      { characterName: 'Baiying' },
      ctx,
    )) as { uri: string; videoUri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.videoUri).toBe('videos/char/baiying.mp4');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'characters', 'baiying.json'),
        'utf8',
      ),
    );
    expect(doc.dynamicSpriteUri).toBe('videos/char/baiying.mp4');
  });
});

describe('characterDesigner.schemas', () => {
  it('declares Tier-1 and Tier-2 tools', () => {
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
