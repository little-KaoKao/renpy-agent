import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { sceneDesignerTools } from './tools.js';

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
