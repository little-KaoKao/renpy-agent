import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  RunningHubClient,
  RunningHubSubmitParams,
  RunningHubTaskResult,
} from '../executers/common/runninghub-client.js';
import {
  registryPathForGame,
  saveRegistry,
  type AssetRegistryFile,
  type AssetRegistryEntry,
} from '../assets/registry.js';
import type { StoryboarderOutput } from './types.js';
import { runCutsceneStage } from './cutscene-stage.js';
import type { FetchLike } from '../assets/download.js';

function entry(e: Partial<AssetRegistryEntry>): AssetRegistryEntry {
  return {
    placeholderId: e.placeholderId ?? 'x',
    logicalKey: e.logicalKey ?? 'x',
    assetType: e.assetType ?? 'scene_background',
    status: e.status ?? 'ready',
    updatedAt: '2026-04-25T00:00:00.000Z',
    ...e,
  } as AssetRegistryEntry;
}

function makeClient(
  failShots: ReadonlyArray<number> = [],
): RunningHubClient & {
  submit: ReturnType<typeof vi.fn>;
  poll: ReturnType<typeof vi.fn>;
} {
  const submit = vi.fn(async (_p: RunningHubSubmitParams) => ({ taskId: 'c-task' }));
  let callIx = 0;
  const poll = vi.fn(async (_taskId: string): Promise<RunningHubTaskResult> => {
    const ix = callIx++;
    if (failShots.includes(ix + 1)) {
      return { status: 'error', errorMessage: `forced-fail-${ix + 1}` };
    }
    return { status: 'done', outputUri: `https://cdn/shot_${ix + 1}.mp4` };
  });
  return { submitTask: submit, pollTask: poll, submit, poll } as any;
}

const fakeFetch = (async () =>
  new Response(new Uint8Array([0x01]), { status: 200 })) as unknown as FetchLike;

describe('runCutsceneStage', () => {
  let gameDir: string;
  let registryPath: string;
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'renpy-cut-'));
    gameDir = resolve(tmp, 'game');
    registryPath = registryPathForGame(gameDir);
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns empty stats when the storyboard has no cutscenes', async () => {
    const board: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 1,
          description: 'boring dialogue',
          characters: ['Hana'],
          sceneName: 'garden',
          staging: 'solo_center',
          transform: 'stand',
          transition: 'fade',
          effects: [],
          dialogueLines: [{ speaker: 'Hana', text: 'hi' }],
        },
      ],
    };
    const client = makeClient();
    const result = await runCutsceneStage({
      storyboarder: board,
      gameDir,
      registryPath,
      runningHubClient: client,
      sleep: async () => {},
      pollIntervalMs: 0,
    });
    expect(result.stats).toEqual({ ok: 0, err: 0, skipped: 0 });
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('resolves a transition cutscene first-frame from scene_background and calls generateCutsceneVideo', async () => {
    // Pre-seed the registry with a ready scene_background.
    const seeded: AssetRegistryFile = {
      version: 1,
      entries: [
        entry({
          placeholderId: 'scene_background:scene:garden:bg',
          logicalKey: 'scene:garden:bg',
          assetType: 'scene_background',
          status: 'ready',
          remoteAssetUri: 'https://cdn/garden.png',
          realAssetLocalPath: 'images/bg/garden.png',
        }),
      ],
    };
    await saveRegistry(registryPath, seeded);

    const board: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 2,
          description: 'transition to sakura',
          characters: [],
          sceneName: 'garden',
          staging: 'none',
          transform: 'pan_left',
          transition: 'fade',
          effects: [],
          dialogueLines: [{ speaker: 'narrator', text: 'wind.' }],
          cutscene: {
            kind: 'transition',
            motionPrompt: 'slow dolly through sakura garden',
            referenceSceneName: 'garden',
          },
        },
      ],
    };

    const client = makeClient();
    const result = await runCutsceneStage({
      storyboarder: board,
      gameDir,
      registryPath,
      runningHubClient: client,
      fetchFn: fakeFetch,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.stats).toEqual({ ok: 1, err: 0, skipped: 0 });
    expect(client.submit).toHaveBeenCalledTimes(1);
    const call = client.submit.mock.calls[0]![0] as RunningHubSubmitParams;
    expect(call.appKey).toBe('CUTSCENE_IMAGE_TO_VIDEO');
    expect(
      call.inputs.find((i) => i.role === 'first_frame')?.value,
    ).toBe('https://cdn/garden.png');
  });

  it('falls back to character_main when scene is not ready but character is', async () => {
    const seeded: AssetRegistryFile = {
      version: 1,
      entries: [
        entry({
          placeholderId: 'character_main:character:hana:main',
          logicalKey: 'character:hana:main',
          assetType: 'character_main',
          status: 'ready',
          remoteAssetUri: 'https://cdn/hana.png',
          realAssetLocalPath: 'images/char/hana.png',
        }),
      ],
    };
    await saveRegistry(registryPath, seeded);

    const board: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 3,
          description: 'key kiss scene',
          characters: ['Hana'],
          sceneName: 'garden',
          staging: 'solo_center',
          transform: 'front',
          transition: 'dissolve',
          effects: [],
          dialogueLines: [{ speaker: 'Hana', text: '...' }],
          cutscene: {
            kind: 'reference',
            motionPrompt: 'soft kiss under moonlight',
            referenceCharacterName: 'Hana',
          },
        },
      ],
    };

    const client = makeClient();
    const result = await runCutsceneStage({
      storyboarder: board,
      gameDir,
      registryPath,
      runningHubClient: client,
      fetchFn: fakeFetch,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.stats.ok).toBe(1);
    const call = client.submit.mock.calls[0]![0] as RunningHubSubmitParams;
    expect(
      call.inputs.find((i) => i.role === 'first_frame')?.value,
    ).toBe('https://cdn/hana.png');
  });

  it('skips a transition when nothing is ready (Coder placeholder still valid)', async () => {
    const board: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 4,
          description: 'opening transition',
          characters: [],
          sceneName: 'sky',
          staging: 'none',
          transform: 'pan_right',
          transition: 'fade',
          effects: [],
          dialogueLines: [{ speaker: 'narrator', text: '...' }],
          cutscene: {
            kind: 'transition',
            motionPrompt: 'title card pan',
            referenceSceneName: 'unknown_scene',
          },
        },
      ],
    };

    const client = makeClient();
    const result = await runCutsceneStage({
      storyboarder: board,
      gameDir,
      registryPath,
      runningHubClient: client,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.stats).toEqual({ ok: 0, err: 0, skipped: 1 });
    expect(client.submit).not.toHaveBeenCalled();
    expect(result.skipped[0]!.shotNumber).toBe(4);
  });

  it('skips a reference cutscene with a logged reason when nothing is ready', async () => {
    const board: StoryboarderOutput = {
      shots: [
        {
          shotNumber: 5,
          description: 'pivotal fight',
          characters: ['Kai'],
          sceneName: 'arena',
          staging: 'solo_center',
          transform: 'front',
          transition: 'none',
          effects: [],
          dialogueLines: [{ speaker: 'Kai', text: '!' }],
          cutscene: {
            kind: 'reference',
            motionPrompt: 'kick',
            referenceCharacterName: 'Kai',
          },
        },
      ],
    };

    const errLog: string[] = [];
    const client = makeClient();
    const result = await runCutsceneStage({
      storyboarder: board,
      gameDir,
      registryPath,
      runningHubClient: client,
      logger: { info: () => {}, error: (m) => errLog.push(m) },
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.stats).toEqual({ ok: 0, err: 0, skipped: 1 });
    expect(client.submit).not.toHaveBeenCalled();
    expect(errLog.some((m) => m.includes('shot 5 skipped'))).toBe(true);
  });

  it('tolerates a failing shot without collapsing the stage', async () => {
    const seeded: AssetRegistryFile = {
      version: 1,
      entries: [
        entry({
          placeholderId: 'scene_background:scene:garden:bg',
          logicalKey: 'scene:garden:bg',
          assetType: 'scene_background',
          status: 'ready',
          remoteAssetUri: 'https://cdn/garden.png',
          realAssetLocalPath: 'images/bg/garden.png',
        }),
      ],
    };
    await saveRegistry(registryPath, seeded);

    const board: StoryboarderOutput = {
      shots: [1, 2].map((n) => ({
        shotNumber: n,
        description: `cutscene ${n}`,
        characters: [],
        sceneName: 'garden',
        staging: 'none',
        transform: 'pan_left',
        transition: 'fade',
        effects: [],
        dialogueLines: [{ speaker: 'narrator', text: '.' }],
        cutscene: {
          kind: 'transition' as const,
          motionPrompt: `motion ${n}`,
          referenceSceneName: 'garden',
        },
      })),
    };

    // Second poll fails (shotNumber 2 in our iteration order = 2nd call).
    const client = makeClient([2]);
    const result = await runCutsceneStage({
      storyboarder: board,
      gameDir,
      registryPath,
      runningHubClient: client,
      fetchFn: fakeFetch,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.stats.ok).toBe(1);
    expect(result.stats.err).toBe(1);
  });
});
