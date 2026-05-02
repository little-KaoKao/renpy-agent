import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { sceneBackgroundGenerator } from './scene-background-generator.js';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';

async function makeCtx(
  overrides: Partial<CommonToolContext> = {},
): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-scene-agent-'));
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

async function seedScene(
  ctx: CommonToolContext,
  slug: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const dir = resolve(ctx.gameDir, '..', 'workspace', 'scenes');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${slug}.json`), JSON.stringify(doc));
}

describe('sceneBackgroundGenerator', () => {
  it('happy path: submits SCENE_BACKGROUND task, downloads, upserts registry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 's1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/classroom.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array(30000), { status: 200 }),
    ) as unknown as FetchLike;
    const ctx = await makeCtx({ runningHubClient: client, fetchFn });
    await seedScene(ctx, 'classroom', {
      name: 'Classroom',
      description: 'afternoon sunlit school classroom',
    });

    const out = await sceneBackgroundGenerator(
      { sceneUri: 'workspace://scene/classroom', timeOfDay: 'dusk' },
      ctx,
    );

    expect(out).toMatchObject({
      status: 'ready',
      localPath: 'images/bg/classroom.png',
      remoteUrl: 'https://cdn/classroom.png',
    });
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ appKey: 'SCENE_BACKGROUND' }),
    );
    const reg = await loadRegistry(registryPathForGame(ctx.gameDir));
    expect(reg.entries[0]!.status).toBe('ready');
  });

  it('error path: missing scene doc returns error without touching RunningHub', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn(),
      pollTask: vi.fn(),
    };
    const ctx = await makeCtx({ runningHubClient: client });
    const out = await sceneBackgroundGenerator(
      { sceneUri: 'workspace://scene/missing' },
      ctx,
    );
    expect(out).toMatchObject({
      error: expect.stringMatching(/not found/),
    });
    expect(client.submitTask).not.toHaveBeenCalled();
  });

  it('DRY_RUN: returns mock remote + local paths', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn(),
      pollTask: vi.fn(),
    };
    const ctx = await makeCtx({ runningHubClient: client });
    await seedScene(ctx, 'cafe', {
      name: 'Cafe',
      description: 'cozy downtown coffee shop',
    });

    const out = await sceneBackgroundGenerator(
      { sceneUri: 'workspace://scene/cafe', DRY_RUN: true },
      ctx,
    );

    expect(out).toMatchObject({
      status: 'dry_run',
      localPath: 'images/bg/cafe.png',
      remoteUrl: expect.stringContaining('dry-run.invalid'),
      dryRun: true,
    });
    expect(client.submitTask).not.toHaveBeenCalled();
  });
});
