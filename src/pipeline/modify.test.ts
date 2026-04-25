import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  modifyCharacterAppearance,
  modifyDialogueLine,
  reorderShots,
} from './modify.js';
import { saveStoryWorkspace, loadStoryWorkspace } from './workspace.js';
import {
  loadRegistry,
  registryPathForGame,
  saveRegistry,
  type AssetRegistryEntry,
  type AssetRegistryFile,
} from '../assets/registry.js';
import { logicalKeyForCharacter } from '../assets/logical-key.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'Sakura',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: '白樱', description: 'protagonist', visualDescription: 'long pink hair' },
    { name: 'Mia', description: 'friend', visualDescription: 'blue eyes' },
  ],
  scenes: [{ name: 'sakura_night', description: 'night under cherry blossoms' }],
  chapterOutline: 'co',
};

const WRITER: WriterOutput = { scenes: [] };

const STORYBOARDER: StoryboarderOutput = {
  shots: [
    {
      shotNumber: 1,
      description: 'first',
      characters: ['白樱'],
      sceneName: 'sakura_night',
      staging: 'enter',
      transforms: 'stand',
      transition: 'fade',
      dialogueLines: [
        { speaker: '白樱', text: '你又来了。' },
        { speaker: 'narrator', text: '她的声音像晚风。' },
      ],
    },
    {
      shotNumber: 2,
      description: 'second',
      characters: ['白樱'],
      sceneName: 'sakura_night',
      staging: 'front',
      transforms: 'lean in',
      transition: 'dissolve',
      dialogueLines: [{ speaker: '白樱', text: '别走。' }],
    },
    {
      shotNumber: 3,
      description: 'third',
      characters: ['Mia'],
      sceneName: 'sakura_night',
      staging: 'lookup',
      transforms: 'stand',
      transition: 'fade',
      dialogueLines: [{ speaker: 'Mia', text: 'Remember?' }],
    },
  ],
};

async function seedWorkspace(gameDir: string): Promise<void> {
  await saveStoryWorkspace(gameDir, {
    planner: PLANNER,
    writer: WRITER,
    storyboarder: STORYBOARDER,
  });
}

describe('modifyCharacterAppearance', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modify-char-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('updates planner.characters entry and leaves storyboarder/writer untouched', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);

    const result = await modifyCharacterAppearance({
      gameDir,
      characterName: '白樱',
      newVisualDescription: 'short pink hair, twin braids',
    });

    const baiying = result.snapshot.planner.characters.find((c) => c.name === '白樱');
    expect(baiying?.visualDescription).toBe('short pink hair, twin braids');
    // Description preserved because caller didn't override.
    expect(baiying?.description).toBe('protagonist');
    // Other characters untouched.
    expect(result.snapshot.planner.characters[1]?.visualDescription).toBe('blue eyes');
    // Storyboarder + writer untouched.
    expect(result.snapshot.storyboarder).toEqual(STORYBOARDER);
    expect(result.snapshot.writer).toEqual(WRITER);
    // Reload from disk to confirm persistence.
    const reloaded = await loadStoryWorkspace(gameDir);
    expect(reloaded.planner.characters[0]?.visualDescription).toBe(
      'short pink hair, twin braids',
    );
    // No registry yet → no change reported.
    expect(result.registryChanged).toBe(false);
  });

  it('invalidates a ready character asset back to placeholder so Coder falls back to Solid()', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);

    const registryPath = registryPathForGame(gameDir);
    const readyEntry: AssetRegistryEntry = {
      placeholderId: 'character_main:character:baiying:main',
      logicalKey: logicalKeyForCharacter('白樱'),
      assetType: 'character_main',
      realAssetLocalPath: 'images/char/baiying.png',
      remoteAssetUri: 'https://cdn/baiying.png',
      status: 'ready',
      updatedAt: '2026-04-23T00:00:00.000Z',
    };
    await saveRegistry(registryPath, { version: 1, entries: [readyEntry] });

    const result = await modifyCharacterAppearance({
      gameDir,
      characterName: '白樱',
      newVisualDescription: 'short pink hair, twin braids',
      now: () => new Date('2026-04-23T12:00:00.000Z'),
    });

    expect(result.registryChanged).toBe(true);
    const reloaded = await loadRegistry(registryPath);
    const entry = reloaded.entries[0]!;
    expect(entry.status).toBe('placeholder');
    // Historical real-asset path preserved (audit trail), but status pulled back.
    expect(entry.realAssetLocalPath).toBe('images/char/baiying.png');
    expect(entry.updatedAt).toBe('2026-04-23T12:00:00.000Z');
  });

  it('throws on unknown character name', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);
    await expect(
      modifyCharacterAppearance({
        gameDir,
        characterName: 'Nobody',
        newVisualDescription: 'x',
      }),
    ).rejects.toThrow(/no character named/);
  });

  it('does not touch registry when existing entry is not ready (still generating)', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);
    const registryPath = registryPathForGame(gameDir);
    const generating: AssetRegistryFile = {
      version: 1,
      entries: [
        {
          placeholderId: 'p',
          logicalKey: logicalKeyForCharacter('白樱'),
          assetType: 'character_main',
          status: 'generating',
          updatedAt: '2026-04-23T00:00:00.000Z',
        },
      ],
    };
    await saveRegistry(registryPath, generating);
    const result = await modifyCharacterAppearance({
      gameDir,
      characterName: '白樱',
      newVisualDescription: 'x',
    });
    expect(result.registryChanged).toBe(false);
    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('generating');
  });
});

describe('modifyDialogueLine', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modify-line-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rewrites a specific line without disturbing siblings or planner', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);

    const next = await modifyDialogueLine({
      gameDir,
      shotNumber: 1,
      lineIndex: 1,
      newText: '夜風のように。',
    });
    const shot1 = next.storyboarder.shots[0]!;
    expect(shot1.dialogueLines[0]?.text).toBe('你又来了。'); // untouched
    expect(shot1.dialogueLines[1]).toEqual({
      speaker: 'narrator',
      text: '夜風のように。',
    });
    expect(next.planner).toEqual(PLANNER);

    const reloaded = await loadStoryWorkspace(gameDir);
    expect(reloaded.storyboarder.shots[0]?.dialogueLines[1]?.text).toBe('夜風のように。');
  });

  it('allows changing the speaker together with the text', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);
    const next = await modifyDialogueLine({
      gameDir,
      shotNumber: 1,
      lineIndex: 0,
      newText: 'Yo.',
      newSpeaker: 'Mia',
    });
    expect(next.storyboarder.shots[0]?.dialogueLines[0]).toEqual({
      speaker: 'Mia',
      text: 'Yo.',
    });
  });

  it('throws when shot or line index is out of range', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);
    await expect(
      modifyDialogueLine({ gameDir, shotNumber: 99, lineIndex: 0, newText: 'x' }),
    ).rejects.toThrow(/shotNumber 99/);
    await expect(
      modifyDialogueLine({ gameDir, shotNumber: 2, lineIndex: 5, newText: 'x' }),
    ).rejects.toThrow(/cannot set index 5/);
  });
});

describe('reorderShots', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reorder-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renumbers shots contiguously after permutation', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);
    const next = await reorderShots({ gameDir, newOrder: [3, 1, 2] });
    const descs = next.storyboarder.shots.map((s) => ({
      num: s.shotNumber,
      desc: s.description,
    }));
    expect(descs).toEqual([
      { num: 1, desc: 'third' },
      { num: 2, desc: 'first' },
      { num: 3, desc: 'second' },
    ]);
    // planner/writer untouched
    expect(next.planner).toEqual(PLANNER);
  });

  it('rejects wrong-length or duplicate orderings', async () => {
    const gameDir = join(dir, 'game');
    await seedWorkspace(gameDir);
    await expect(reorderShots({ gameDir, newOrder: [1, 2] })).rejects.toThrow(
      /expected 3/,
    );
    await expect(reorderShots({ gameDir, newOrder: [1, 1, 2] })).rejects.toThrow(
      /duplicate shotNumber 1/,
    );
    await expect(reorderShots({ gameDir, newOrder: [1, 2, 9] })).rejects.toThrow(
      /shotNumber 9 not in current/,
    );
  });
});
