import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { sceneDesignerTools } from './tools.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';

async function makeCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-scenedesigner-'));
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

describe('sceneDesigner.create_or_update_scene', () => {
  it('creates a new scene with slug derived from name', async () => {
    const ctx = await makeCtx();
    const res = await sceneDesignerTools.executors.create_or_update_scene!(
      { name: 'Classroom at Sunset', description: 'empty room, warm light' },
      ctx,
    );
    expect(res).toMatchObject({
      uri: 'workspace://scene/classroom-at-sunset',
      status: 'placeholder',
    });
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'scenes', 'classroom-at-sunset.json'),
        'utf8',
      ),
    );
    expect(doc.name).toBe('Classroom at Sunset');
  });

  it('updates by URI', async () => {
    const ctx = await makeCtx();
    await sceneDesignerTools.executors.create_or_update_scene!(
      { name: 'X', description: 'v1', backgroundUri: 'images/scenes/x.png' },
      ctx,
    );
    const res = await sceneDesignerTools.executors.create_or_update_scene!(
      { uri: 'workspace://scene/x', description: 'v2' },
      ctx,
    );
    expect(res).toMatchObject({ uri: 'workspace://scene/x' });
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'scenes', 'x.json'),
        'utf8',
      ),
    );
    expect(doc.description).toBe('v2');
    expect(doc.backgroundUri).toBe('images/scenes/x.png');
    expect(doc.status).toBe('ready');
  });
});

async function makeCtxWithClient() {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-scene-tier2-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  const client: RunningHubClient = {
    submitTask: vi.fn().mockResolvedValue({ taskId: 's1' }),
    pollTask: vi.fn().mockResolvedValue({ status: 'done', outputUri: 'https://cdn/img.png' }),
  };
  const fetchFn: FetchLike = vi.fn(
    async () => new Response(new Uint8Array([9, 9]), { status: 200 }),
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

describe('sceneDesigner.generate_prop', () => {
  it('errors on missing args', async () => {
    const ctx = await makeCtxWithClient();
    const res = await sceneDesignerTools.executors.generate_prop!(
      { propName: 'umbrella' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/description required/) });
  });

  it('persists Prop doc and returns uri', async () => {
    const ctx = await makeCtxWithClient();
    const res = (await sceneDesignerTools.executors.generate_prop!(
      { propName: 'umbrella', description: 'red folded umbrella' },
      ctx,
    )) as { uri: string; imageUri: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.uri).toBe('workspace://prop/umbrella');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'props', 'umbrella.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({ name: 'umbrella', description: 'red folded umbrella' });
  });
});

describe('sceneDesigner.generate_scene_time_variant', () => {
  it('errors when scene not found', async () => {
    const ctx = await makeCtxWithClient();
    const res = await sceneDesignerTools.executors.generate_scene_time_variant!(
      { sceneName: 'classroom', timeOfDay: 'dusk' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/scene not found/) });
  });

  it('errors when timeOfDay missing', async () => {
    const ctx = await makeCtxWithClient();
    const res = await sceneDesignerTools.executors.generate_scene_time_variant!(
      { sceneName: 'classroom' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/timeOfDay/) });
  });

  it('appends time variant and updates scene doc', async () => {
    const ctx = await makeCtxWithClient();
    await writeWorkspaceDoc('workspace://scene/classroom', ctx.gameDir, {
      name: 'classroom',
      description: 'empty classroom',
      backgroundUri: 'images/bg/classroom.png',
      status: 'ready',
    });
    const res = (await sceneDesignerTools.executors.generate_scene_time_variant!(
      {
        sceneName: 'classroom',
        timeOfDay: 'dusk',
        lightingDescription: 'warm orange',
      },
      ctx,
    )) as { uri: string; timeOfDay: string; imageUri: string };
    expect(res.timeOfDay).toBe('dusk');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'scenes', 'classroom.json'),
        'utf8',
      ),
    );
    expect(doc.timeVariants).toHaveLength(1);
    expect(doc.timeVariants[0]).toMatchObject({
      timeOfDay: 'dusk',
      lightingDescription: 'warm orange',
    });
  });
});
