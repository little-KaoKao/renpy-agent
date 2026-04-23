import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadStoryWorkspace,
  saveStoryWorkspace,
  workspacePathsForGame,
} from './workspace.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'T',
  genre: 'g',
  tone: 't',
  characters: [{ name: 'A', description: 'd', visualDescription: 'v' }],
  scenes: [{ name: 's', description: 'ds' }],
  chapterOutline: 'co',
};

const WRITER: WriterOutput = {
  scenes: [{ location: 's', characters: ['A'], lines: [{ speaker: 'A', text: 'hi' }] }],
};

const STORYBOARDER: StoryboarderOutput = {
  shots: [
    {
      shotNumber: 1,
      description: 'd',
      characters: ['A'],
      sceneName: 's',
      staging: 'enter',
      transforms: 'stand',
      transition: 'fade',
      dialogueLines: [{ speaker: 'A', text: 'hi' }],
    },
  ],
};

describe('workspace paths', () => {
  it('places workspace sibling to game dir', () => {
    const paths = workspacePathsForGame('/root/runtime/games/demo/game');
    expect(paths.workspaceDir).toMatch(/runtime[\\/]games[\\/]demo[\\/]workspace$/);
    expect(paths.plannerPath).toMatch(/planner\.json$/);
  });
});

describe('saveStoryWorkspace/loadStoryWorkspace', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workspace-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips the three JSON artifacts', async () => {
    const gameDir = join(dir, 'game');
    const paths = await saveStoryWorkspace(gameDir, {
      planner: PLANNER,
      writer: WRITER,
      storyboarder: STORYBOARDER,
    });
    const plannerRaw = await readFile(paths.plannerPath, 'utf8');
    expect(plannerRaw).toContain('projectTitle');

    const reloaded = await loadStoryWorkspace(gameDir);
    expect(reloaded.planner).toEqual(PLANNER);
    expect(reloaded.writer).toEqual(WRITER);
    expect(reloaded.storyboarder).toEqual(STORYBOARDER);
  });
});
