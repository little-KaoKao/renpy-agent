import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  RunningHubClient,
  RunningHubSubmitParams,
  RunningHubTaskResult,
} from '../executers/common/runninghub-client.js';
import { loadRegistry } from '../assets/registry.js';
import type { PlannerOutput } from './types.js';
import { runVisualStage } from './visual-stage.js';

const PLANNER: PlannerOutput = {
  projectTitle: 'Test',
  genre: 'romance',
  tone: 'tender',
  characters: [
    { name: 'Hana', description: 'lead', visualDescription: 'pink hair, school uniform' },
    { name: 'Kai', description: 'co-lead', visualDescription: 'black hair, school uniform' },
  ],
  scenes: [
    { name: 'garden', description: 'moonlit sakura garden' },
    { name: 'corridor', description: 'empty school hallway' },
  ],
  chapterOutline: 'a short demo',
};

function makeClient(options: { characterFail?: boolean; sceneFail?: boolean } = {}) {
  const submit = vi.fn(async (p: RunningHubSubmitParams) => ({ taskId: `${p.appKey}-t` }));
  const poll = vi.fn(async (taskId: string): Promise<RunningHubTaskResult> => {
    if (options.characterFail && taskId.startsWith('CHARACTER_MAIN_IMAGE')) {
      return { status: 'error', errorMessage: 'mj down' };
    }
    if (options.sceneFail && taskId.startsWith('SCENE_BACKGROUND')) {
      return { status: 'error', errorMessage: 'nb down' };
    }
    return { status: 'done', outputUri: `https://cdn/${taskId}.png` };
  });
  return { submitTask: submit, pollTask: poll, submit, poll } as RunningHubClient & {
    submit: typeof submit;
    poll: typeof poll;
  };
}

const fakeFetch = (async () =>
  new Response(new Uint8Array([0x89, 0x50]), { status: 200 })) as unknown as typeof fetch;

describe('runVisualStage', () => {
  let tmp: string;
  let gameDir: string;
  let registryPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'visual-stage-'));
    gameDir = resolve(tmp, 'game');
    registryPath = resolve(tmp, 'asset-registry.json');
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('generates one asset per character and per scene', async () => {
    const client = makeClient();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      const result = await runVisualStage({
        planner: PLANNER,
        gameDir,
        registryPath,
        runningHubClient: client,
        pollIntervalMs: 0,
        sleep: async () => {},
      });
      expect(result.stats.character).toEqual({ ok: 2, err: 0 });
      expect(result.stats.scene).toEqual({ ok: 2, err: 0 });

      const registry = await loadRegistry(registryPath);
      const logicalKeys = registry.entries.map((e) => e.logicalKey).sort();
      expect(logicalKeys).toEqual(
        [
          'character:hana:main',
          'character:kai:main',
          'scene:corridor:bg',
          'scene:garden:bg',
        ].sort(),
      );

      // One submit call per asset: 2 characters + 2 scenes.
      expect(client.submit).toHaveBeenCalledTimes(4);
      expect(client.submit).toHaveBeenCalledWith(
        expect.objectContaining({ appKey: 'CHARACTER_MAIN_IMAGE' }),
      );
      expect(client.submit).toHaveBeenCalledWith(
        expect.objectContaining({ appKey: 'SCENE_BACKGROUND' }),
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('tolerates a failing character without collapsing the scene batch', async () => {
    const client = makeClient({ characterFail: true });
    const errors: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      const result = await runVisualStage({
        planner: PLANNER,
        gameDir,
        registryPath,
        runningHubClient: client,
        logger: { info: () => {}, error: (m) => errors.push(m) },
        pollIntervalMs: 0,
        sleep: async () => {},
      });
      expect(result.stats.character.err).toBe(2);
      expect(result.stats.character.ok).toBe(0);
      expect(result.stats.scene).toEqual({ ok: 2, err: 0 });
      expect(errors.some((m) => m.includes('character "Hana" failed'))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns zero stats for an empty planner without calling the client', async () => {
    const client = makeClient();
    const emptyPlanner: PlannerOutput = { ...PLANNER, characters: [], scenes: [] };
    const result = await runVisualStage({
      planner: emptyPlanner,
      gameDir,
      registryPath,
      runningHubClient: client,
    });
    expect(result.stats).toEqual({
      character: { ok: 0, err: 0 },
      scene: { ok: 0, err: 0 },
    });
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('runs character and scene batches in parallel and every entry lands in the registry', async () => {
    const manyPlanner: PlannerOutput = {
      ...PLANNER,
      characters: Array.from({ length: 4 }, (_, i) => ({
        name: `Char${i}`,
        description: 'x',
        visualDescription: 'x',
      })),
      scenes: Array.from({ length: 4 }, (_, i) => ({ name: `scene_${i}`, description: 'd' })),
    };
    const submit = vi.fn(async (p: RunningHubSubmitParams) => ({
      taskId: `${p.appKey}-${p.inputs.find((i) => i.role === 'prompt' || i.role === 'title')?.value ?? 'x'}`,
    }));
    let inflight = 0;
    let peak = 0;
    const poll = vi.fn(async (taskId: string): Promise<RunningHubTaskResult> => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 8));
      inflight--;
      return { status: 'done', outputUri: `https://cdn/${taskId}.png` };
    });
    const client = { submitTask: submit, pollTask: poll, submit, poll } as any;

    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      const result = await runVisualStage({
        planner: manyPlanner,
        gameDir,
        registryPath,
        runningHubClient: client,
        pollIntervalMs: 0,
        sleep: async () => {},
        concurrency: 4,
      });
      expect(result.stats.character).toEqual({ ok: 4, err: 0 });
      expect(result.stats.scene).toEqual({ ok: 4, err: 0 });
      // With character + scene batches both running in parallel at cap 4, we
      // should see more than 4 inflight tasks across both groups.
      expect(peak).toBeGreaterThan(4);

      const registry = await loadRegistry(registryPath);
      const characterEntries = registry.entries.filter((e) => e.assetType === 'character_main');
      const sceneEntries = registry.entries.filter((e) => e.assetType === 'scene_background');
      expect(characterEntries).toHaveLength(4);
      expect(sceneEntries).toHaveLength(4);
      expect(registry.entries.every((e) => e.status === 'ready')).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
