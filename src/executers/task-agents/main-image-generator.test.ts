import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { characterMainImageGenerator } from './main-image-generator.js';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type {
  RunningHubClient,
  FetchLike as RhFetchLike,
} from '../common/runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';

async function makeCtx(
  overrides: Partial<CommonToolContext> = {},
): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-char-agent-'));
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

async function seedCharacter(
  ctx: CommonToolContext,
  slug: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const dir = resolve(ctx.gameDir, '..', 'workspace', 'characters');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${slug}.json`), JSON.stringify(doc));
}

describe('characterMainImageGenerator', () => {
  it('happy path: submits RunningHub task, downloads asset, updates registry, returns ready', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 't1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/baiying.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array(20480), { status: 200 }),
    ) as unknown as FetchLike;
    const ctx = await makeCtx({
      runningHubClient: client,
      fetchFn,
    });
    await seedCharacter(ctx, 'baiying', {
      name: 'Baiying',
      visualDescription: 'pink hair, school uniform',
    });

    const out = await characterMainImageGenerator(
      {
        characterUri: 'workspace://character/baiying',
        prompt: 'expanded MJ v7 prompt text',
      },
      ctx,
    );

    expect(out).toMatchObject({
      status: 'ready',
      localPath: 'images/char/baiying.png',
      remoteUrl: 'https://cdn/baiying.png',
    });
    expect((out as { byteLength: number }).byteLength).toBeGreaterThan(0);
    expect(client.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ appKey: 'CHARACTER_MAIN_IMAGE' }),
    );
    const reg = await loadRegistry(registryPathForGame(ctx.gameDir));
    expect(reg.entries[0]!.status).toBe('ready');
  });

  it('error path: RunningHub task fails → status=error + asset-registry has error entry', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 't1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'error',
        errorMessage: 'rate-limited',
      }),
    };
    const ctx = await makeCtx({ runningHubClient: client });
    await seedCharacter(ctx, 'mary', {
      name: 'Mary',
      visualDescription: 'short brown hair',
    });

    const out = await characterMainImageGenerator(
      { characterUri: 'workspace://character/mary' },
      ctx,
    );

    expect(out).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/rate-limited/),
    });
    const reg = await loadRegistry(registryPathForGame(ctx.gameDir));
    expect(reg.entries[0]!.status).toBe('error');
  });

  it('DRY_RUN: returns mock URI + localPath without invoking client', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn(),
      pollTask: vi.fn(),
    };
    const ctx = await makeCtx({ runningHubClient: client });
    await seedCharacter(ctx, 'ai', {
      name: 'Ai',
      visualDescription: 'black hair',
    });

    const out = await characterMainImageGenerator(
      { characterUri: 'workspace://character/ai', DRY_RUN: true },
      ctx,
    );

    expect(out).toMatchObject({
      status: 'dry_run',
      localPath: 'images/bg/ai.png'.replace('bg', 'char'),
      remoteUrl: expect.stringContaining('dry-run.invalid'),
      dryRun: true,
    });
    expect(client.submitTask).not.toHaveBeenCalled();
  });
});
