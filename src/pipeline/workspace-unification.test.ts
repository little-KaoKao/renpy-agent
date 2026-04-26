// v0.7 workspace-unification regression tests.
//
// These tests cover the three invariants PLAN §1 (v0.7 branch plan) calls out:
//   1. saveStoryWorkspacePerUri produces per-URI docs that are byte-equivalent
//      (for the round-tripped core fields) to the aggregate JSON.
//   2. A V5-shaped workspace (per-URI docs only, no aggregate JSON) can be
//      read by `modifyCharacterAppearance` and mutated back into per-URI docs.
//   3. CJK-only character names ('白樱' / '樱白') produce distinct slugs
//      after the hardening in src/assets/download.ts.

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../agents/workspace-io.js';
import { slugForFilename } from '../assets/download.js';
import { modifyCharacterAppearance } from './modify.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';
import {
  saveStoryWorkspace,
  saveStoryWorkspacePerUri,
} from './workspace.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'Sakura Night',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: '白樱', description: 'female lead', visualDescription: 'long pink hair' },
    { name: '樱白', description: 'rival', visualDescription: 'short black hair' },
  ],
  scenes: [{ name: 'sakura_night', description: 'night under cherry blossoms' }],
  chapterOutline: 'They meet.',
};

const WRITER: WriterOutput = {
  scenes: [
    {
      location: 'sakura_night',
      characters: ['白樱'],
      lines: [{ speaker: '白樱', text: '你又来了。' }],
    },
  ],
};

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
      dialogueLines: [{ speaker: '白樱', text: '你又来了。' }],
    },
  ],
};

describe('saveStoryWorkspacePerUri', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'perUri-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a per-URI doc per character and scene with distinct slugs for CJK names', async () => {
    const gameDir = join(dir, 'game');
    const result = await saveStoryWorkspacePerUri(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });

    // Each character landed in its own char_<hash> file — no collision.
    expect(result.characterUris.length).toBe(2);
    expect(new Set(result.characterUris).size).toBe(2);
    for (const uri of result.characterUris) {
      expect(uri).toMatch(/^workspace:\/\/character\/char_[0-9a-f]{8}$/);
    }
    // Corresponding JSON files exist.
    const wsDir = resolve(gameDir, '..', 'workspace');
    const baiyingSlug = slugForFilename('白樱');
    const yingbaiSlug = slugForFilename('樱白');
    expect(baiyingSlug).not.toBe(yingbaiSlug);
    await stat(resolve(wsDir, 'characters', `${baiyingSlug}.json`));
    await stat(resolve(wsDir, 'characters', `${yingbaiSlug}.json`));
  });

  it('per-URI core fields round-trip equivalent to aggregate JSON', async () => {
    const gameDir = join(dir, 'game');
    // Write both layouts.
    await saveStoryWorkspace(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });
    const perUri = await saveStoryWorkspacePerUri(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });

    // Project metadata.
    const project = await readWorkspaceDoc<{
      title: string;
      genre: string;
      tone: string;
      status: string;
    }>(perUri.projectUri, gameDir);
    expect(project).toMatchObject({
      title: PLANNER.projectTitle,
      genre: PLANNER.genre,
      tone: PLANNER.tone,
      status: 'ready',
    });

    // Chapter.
    const chapter = await readWorkspaceDoc<{ outline: string }>(perUri.chapterUri, gameDir);
    expect(chapter?.outline).toBe(PLANNER.chapterOutline);

    // Script / storyboard are byte-equal to their aggregate counterparts
    // because the per-URI writer stores the same object shape.
    const wsDir = resolve(gameDir, '..', 'workspace');
    const scriptPerUri = await readFile(resolve(wsDir, 'script.json'), 'utf8');
    const writerAgg = await readFile(resolve(wsDir, 'writer.json'), 'utf8');
    expect(scriptPerUri).toBe(writerAgg);
    const sbPerUri = await readFile(resolve(wsDir, 'storyboard.json'), 'utf8');
    const sbAgg = await readFile(resolve(wsDir, 'storyboarder.json'), 'utf8');
    expect(sbPerUri).toBe(sbAgg);

    // Characters round-trip name/description/visualDescription.
    const baiying = await readWorkspaceDoc<{
      name: string;
      description: string;
      visualDescription: string;
    }>(`workspace://character/${slugForFilename('白樱')}`, gameDir);
    expect(baiying).toMatchObject({
      name: '白樱',
      description: 'female lead',
      visualDescription: 'long pink hair',
    });
  });
});

describe('modifyCharacterAppearance — V5 per-URI-only project', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'v5-modify-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the V5 layout (no aggregate JSON) and writes back to per-URI', async () => {
    const gameDir = join(dir, 'game');
    // Seed only the per-URI layout — simulating a `renpy-agent v5` produced project.
    await saveStoryWorkspacePerUri(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });

    const result = await modifyCharacterAppearance({
      gameDir,
      characterName: '白樱',
      newVisualDescription: 'short pink hair, twin braids',
    });

    // Returned snapshot reflects the change.
    expect(
      result.snapshot.planner.characters.find((c) => c.name === '白樱')?.visualDescription,
    ).toBe('short pink hair, twin braids');

    // Per-URI doc updated.
    const baiying = await readWorkspaceDoc<{ visualDescription: string; name: string }>(
      `workspace://character/${slugForFilename('白樱')}`,
      gameDir,
    );
    expect(baiying?.visualDescription).toBe('short pink hair, twin braids');

    // Aggregate JSON was NOT created — we don't want to regress V5 projects
    // into having a stale aggregate file that fights per-URI from now on.
    const wsDir = resolve(gameDir, '..', 'workspace');
    await expect(readFile(resolve(wsDir, 'planner.json'), 'utf8')).rejects.toBeDefined();
  });

  it('upgrades a v0.4 project (aggregate-only) by writing a per-URI mirror on modify', async () => {
    const gameDir = join(dir, 'game');
    // Seed aggregate only — simulating a legacy v0.4 project on disk.
    await saveStoryWorkspace(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });

    await modifyCharacterAppearance({
      gameDir,
      characterName: '白樱',
      newVisualDescription: 'short pink hair',
    });

    // Aggregate still present AND updated — v0.4 compat preserved.
    const wsDir = resolve(gameDir, '..', 'workspace');
    const planner = JSON.parse(await readFile(resolve(wsDir, 'planner.json'), 'utf8'));
    expect(planner.characters[0].visualDescription).toBe('short pink hair');

    // Per-URI character doc was created so the next V5 tool run sees the change.
    const baiying = await readWorkspaceDoc<{ visualDescription: string }>(
      `workspace://character/${slugForFilename('白樱')}`,
      gameDir,
    );
    expect(baiying?.visualDescription).toBe('short pink hair');
  });

  it('falls back to the legacy "asset" slug for projects that used the pre-hardening slug', async () => {
    const gameDir = join(dir, 'game');
    // Mirror a v0.6-era on-disk layout where 白樱 had collapsed to the
    // literal 'asset' filename under `characters/`.
    await writeWorkspaceDoc('workspace://character/asset', gameDir, {
      name: '白樱',
      description: 'female lead',
      visualDescription: 'long pink hair',
      mainImageUri: null,
      status: 'placeholder',
    });
    // Also seed a minimal aggregate so loadWorkspaceForModify has a planner.
    await saveStoryWorkspace(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });

    await modifyCharacterAppearance({
      gameDir,
      characterName: '白樱',
      newVisualDescription: 'short pink hair',
    });

    // The legacy-location doc was updated in place (not re-created under a new slug)
    // so old AssetRegistry entries pointing at the 'asset' slug stay coherent.
    const legacy = await readWorkspaceDoc<{ visualDescription: string }>(
      'workspace://character/asset',
      gameDir,
    );
    expect(legacy?.visualDescription).toBe('short pink hair');
  });
});
