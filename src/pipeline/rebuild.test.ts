import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuildGameProject } from './rebuild.js';
import { saveStoryWorkspace } from './workspace.js';
import { registryPathForGame, saveRegistry } from '../assets/registry.js';
import { logicalKeyForCharacter } from '../assets/logical-key.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'Sakura',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: '白樱', description: 'protagonist', visualDescription: 'long pink hair' },
  ],
  scenes: [{ name: 'sakura_night', description: 'night under cherry blossoms' }],
  chapterOutline: 'co',
};

const WRITER: WriterOutput = { scenes: [] };

const STORYBOARDER: StoryboarderOutput = {
  shots: [
    {
      shotNumber: 1,
      description: 'opening',
      characters: ['白樱'],
      sceneName: 'sakura_night',
      staging: 'enter',
      transforms: 'stand',
      transition: 'fade',
      dialogueLines: [{ speaker: '白樱', text: '你来了。' }],
    },
  ],
};

async function seedWorkspace(runtimeRoot: string, storyName: string): Promise<string> {
  const gameDir = join(runtimeRoot, 'games', storyName, 'game');
  await saveStoryWorkspace(gameDir, {
    planner: PLANNER,
    writer: WRITER,
    storyboarder: STORYBOARDER,
  });
  return gameDir;
}

describe('rebuildGameProject', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rebuild-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders script.rpy from a workspace snapshot', async () => {
    const runtimeRoot = join(dir, 'runtime');
    const gameDir = await seedWorkspace(runtimeRoot, 'demo');

    const result = await rebuildGameProject({ storyName: 'demo', runtimeRoot, repoRoot: dir });

    expect(result.gamePath).toBe(gameDir);
    // runQa is skipped when the Ren'Py SDK executable is absent (dir is an empty tmpdir).
    expect(result.testRun.result).toBe('skipped');

    const script = await readFile(join(gameDir, 'script.rpy'), 'utf8');
    expect(script).toContain('白樱');
    expect(script).toContain('你来了。');
  });

  it('reads asset-registry.json when present and passes it to the coder', async () => {
    const runtimeRoot = join(dir, 'runtime');
    const gameDir = await seedWorkspace(runtimeRoot, 'demo');
    const registryPath = registryPathForGame(gameDir);
    await saveRegistry(registryPath, {
      version: 1,
      entries: [
        {
          placeholderId: 'ph_char_baiying',
          logicalKey: logicalKeyForCharacter('白樱'),
          assetType: 'character_main',
          placeholderImagePath: 'images/placeholder/baiying.png',
          realAssetLocalPath: 'images/char/baiying.png',
          remoteAssetUri: 'https://example/baiying.png',
          status: 'ready',
          updatedAt: '2026-04-25T00:00:00.000Z',
        },
      ],
    });

    const result = await rebuildGameProject({ storyName: 'demo', runtimeRoot, repoRoot: dir });

    expect(result.gamePath).toBe(gameDir);
    const script = await readFile(join(gameDir, 'script.rpy'), 'utf8');
    // When a ready registry entry exists for the character, Coder should emit
    // the real asset path instead of a Solid placeholder.
    expect(script).toContain('images/char/baiying.png');
  });

  it('throws a clear error when the workspace directory is missing', async () => {
    const runtimeRoot = join(dir, 'runtime');
    // No seedWorkspace call → workspace/ does not exist.
    await expect(
      rebuildGameProject({ storyName: 'missing-story', runtimeRoot, repoRoot: dir }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
