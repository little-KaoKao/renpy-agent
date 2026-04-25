import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { producerTools } from './tools.js';

async function makeCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-producer-'));
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

describe('producer.create_project', () => {
  it('writes project.json and returns its URI', async () => {
    const ctx = await makeCtx();
    const res = await producerTools.executors.create_project!(
      { title: 'Sakura', genre: 'romance', tone: 'bittersweet' },
      ctx,
    );
    expect(res).toMatchObject({ uri: 'workspace://project' });
    const text = await readFile(
      resolve(ctx.gameDir, '..', 'workspace', 'project.json'),
      'utf8',
    );
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({
      title: 'Sakura',
      genre: 'romance',
      tone: 'bittersweet',
    });
  });

  it('rejects missing required fields', async () => {
    const ctx = await makeCtx();
    const res = await producerTools.executors.create_project!(
      { title: '', genre: '', tone: '' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.any(String) });
  });
});

describe('producer.create_chapter', () => {
  it('writes chapter.json linked to project', async () => {
    const ctx = await makeCtx();
    await producerTools.executors.create_project!(
      { title: 'Sakura', genre: 'romance', tone: 'bittersweet' },
      ctx,
    );
    const res = await producerTools.executors.create_chapter!(
      {
        projectUri: 'workspace://project',
        outline: 'Chapter 1: first meeting',
      },
      ctx,
    );
    expect(res).toMatchObject({ uri: 'workspace://chapter' });
    const text = await readFile(
      resolve(ctx.gameDir, '..', 'workspace', 'chapter.json'),
      'utf8',
    );
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({
      projectUri: 'workspace://project',
      outline: 'Chapter 1: first meeting',
    });
  });

  it('errors when project is missing', async () => {
    const ctx = await makeCtx();
    const res = await producerTools.executors.create_chapter!(
      { projectUri: 'workspace://project', outline: 'x' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/project/i) });
  });
});

describe('producer.schemas', () => {
  it('lists both tools', () => {
    const names = producerTools.schemas.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['create_project', 'create_chapter']));
  });
});
