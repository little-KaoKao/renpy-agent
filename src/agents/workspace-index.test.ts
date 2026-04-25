import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildWorkspaceIndex,
  parseWorkspaceUri,
  resolveUriToPath,
} from './workspace-index.js';

async function makeGameDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-workspace-'));
  const gameDir = resolve(root, 'game');
  await mkdir(gameDir, { recursive: true });
  return gameDir;
}

describe('parseWorkspaceUri', () => {
  it('parses workspace://<kind>/<slug>', () => {
    expect(parseWorkspaceUri('workspace://character/baiying')).toEqual({
      kind: 'character',
      slug: 'baiying',
    });
  });

  it('parses workspace://<kind> singleton (no slug) for project/chapter/script/storyboard', () => {
    expect(parseWorkspaceUri('workspace://project')).toEqual({
      kind: 'project',
      slug: null,
    });
    expect(parseWorkspaceUri('workspace://script')).toEqual({
      kind: 'script',
      slug: null,
    });
  });

  it('rejects non-workspace:// URIs', () => {
    expect(() => parseWorkspaceUri('http://foo')).toThrow(/workspace:\/\//);
  });

  it('rejects unknown kinds', () => {
    expect(() => parseWorkspaceUri('workspace://unknown/x')).toThrow(/unknown kind/);
  });
});

describe('resolveUriToPath', () => {
  it('singleton kind → <workspace>/<kind>.json', async () => {
    const gameDir = await makeGameDir();
    expect(resolveUriToPath('workspace://project', gameDir)).toBe(
      resolve(gameDir, '..', 'workspace', 'project.json'),
    );
    expect(resolveUriToPath('workspace://script', gameDir)).toBe(
      resolve(gameDir, '..', 'workspace', 'script.json'),
    );
  });

  it('character/scene kind with slug → <workspace>/<kind>s/<slug>.json', async () => {
    const gameDir = await makeGameDir();
    expect(resolveUriToPath('workspace://character/baiying', gameDir)).toBe(
      resolve(gameDir, '..', 'workspace', 'characters', 'baiying.json'),
    );
    expect(resolveUriToPath('workspace://scene/classroom', gameDir)).toBe(
      resolve(gameDir, '..', 'workspace', 'scenes', 'classroom.json'),
    );
  });

  it('throws when character/scene URI has no slug', async () => {
    const gameDir = await makeGameDir();
    expect(() => resolveUriToPath('workspace://character', gameDir)).toThrow(/slug/);
  });
});

describe('buildWorkspaceIndex', () => {
  it('returns empty index for empty workspace', async () => {
    const gameDir = await makeGameDir();
    const index = await buildWorkspaceIndex(gameDir);
    expect(index.entries).toEqual([]);
  });

  it('indexes project + chapter singletons', async () => {
    const gameDir = await makeGameDir();
    const wsDir = resolve(gameDir, '..', 'workspace');
    await mkdir(wsDir, { recursive: true });
    await writeFile(
      resolve(wsDir, 'project.json'),
      JSON.stringify({ title: 'Sakura', genre: 'romance', tone: 'bittersweet' }),
    );
    await writeFile(
      resolve(wsDir, 'chapter.json'),
      JSON.stringify({ title: 'Chapter 1', outline: '...' }),
    );

    const index = await buildWorkspaceIndex(gameDir);
    const byUri = Object.fromEntries(index.entries.map((e) => [e.uri, e]));
    expect(byUri['workspace://project']).toMatchObject({
      kind: 'project',
      title: 'Sakura',
    });
    expect(byUri['workspace://chapter']).toMatchObject({
      kind: 'chapter',
      title: 'Chapter 1',
    });
  });

  it('indexes characters/ and scenes/ subdirectories', async () => {
    const gameDir = await makeGameDir();
    const wsDir = resolve(gameDir, '..', 'workspace');
    await mkdir(resolve(wsDir, 'characters'), { recursive: true });
    await mkdir(resolve(wsDir, 'scenes'), { recursive: true });
    await writeFile(
      resolve(wsDir, 'characters', 'baiying.json'),
      JSON.stringify({ name: 'Baiying', status: 'ready' }),
    );
    await writeFile(
      resolve(wsDir, 'scenes', 'classroom.json'),
      JSON.stringify({ name: 'Classroom', status: 'placeholder' }),
    );

    const index = await buildWorkspaceIndex(gameDir);
    const byUri = Object.fromEntries(index.entries.map((e) => [e.uri, e]));
    expect(byUri['workspace://character/baiying']).toMatchObject({
      kind: 'character',
      title: 'Baiying',
      status: 'ready',
    });
    expect(byUri['workspace://scene/classroom']).toMatchObject({
      kind: 'scene',
      title: 'Classroom',
      status: 'placeholder',
    });
  });

  it('formats index as LLM-friendly text', async () => {
    const gameDir = await makeGameDir();
    const wsDir = resolve(gameDir, '..', 'workspace');
    await mkdir(resolve(wsDir, 'characters'), { recursive: true });
    await writeFile(
      resolve(wsDir, 'characters', 'baiying.json'),
      JSON.stringify({ name: 'Baiying', status: 'ready' }),
    );

    const index = await buildWorkspaceIndex(gameDir);
    const text = index.formatForPrompt();
    expect(text).toContain('workspace://character/baiying');
    expect(text).toContain('Baiying');
    expect(text).toContain('ready');
  });
});
