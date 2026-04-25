import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCharacterExpressionPrompt,
  generateCharacterExpression,
} from './generate-expression.js';
import type { RunningHubClient } from '../common/runninghub-client.js';
import { loadRegistry, registryPathForGame } from '../../assets/registry.js';
import type { FetchLike } from '../../assets/download.js';

describe('buildCharacterExpressionPrompt', () => {
  it('appends a same-character continuity hint by default', () => {
    const out = buildCharacterExpressionPrompt('smiling, eyes closed');
    expect(out).toMatch(/same character/i);
  });

  it('respects styleHint', () => {
    const out = buildCharacterExpressionPrompt('tearful', 'watercolor');
    expect(out).toContain('watercolor');
  });
});

describe('generateCharacterExpression', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'char-expr-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('submits CHARACTER_EXPRESSION with prompt + reference_image_1 when one ref is given', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'e1' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/smiling.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    const result = await generateCharacterExpression({
      characterName: 'Baiying',
      expressionName: 'smiling',
      referenceImages: ['https://cdn/baiying-main.png'],
      expressionPrompt: 'smiling softly, eyes closed',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    expect(result.entry.assetType).toBe('character_expression');
    expect(result.entry.logicalKey).toBe('character:baiying:expr:smiling');
    expect(result.entry.realAssetLocalPath).toBe('images/char/baiying__smiling.png');

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('ready');

    const call = (client.submitTask as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.appKey).toBe('CHARACTER_EXPRESSION');
    const roles = call.inputs.map((i: { role: string }) => i.role).sort();
    expect(roles).toEqual(['prompt', 'reference_image_1']);
  });

  it('passes all 3 reference image roles when 3 urls are supplied', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'e2' }),
      pollTask: vi.fn().mockResolvedValue({
        status: 'done',
        outputUri: 'https://cdn/angry.png',
      }),
    };
    const fetchFn: FetchLike = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as FetchLike;

    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await generateCharacterExpression({
      characterName: 'Kai',
      expressionName: 'angry',
      referenceImages: [
        'https://cdn/kai-main.png',
        'https://cdn/kai-outfit.png',
        'https://cdn/kai-pose.png',
      ],
      expressionPrompt: 'glaring angrily',
      gameDir,
      registryPath,
      client,
      fetchFn,
      sleep: async () => {},
      pollIntervalMs: 0,
    });

    const call = (client.submitTask as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const roles = call.inputs.map((i: { role: string }) => i.role).sort();
    expect(roles).toEqual([
      'prompt',
      'reference_image_1',
      'reference_image_2',
      'reference_image_3',
    ]);
  });

  it('rejects when no reference image is provided', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn(),
      pollTask: vi.fn(),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateCharacterExpression({
        characterName: 'X',
        expressionName: 'neutral',
        referenceImages: [],
        expressionPrompt: 'neutral',
        gameDir,
        registryPath,
        client,
      }),
    ).rejects.toThrow(/at least one/);
    expect(client.submitTask).not.toHaveBeenCalled();
  });

  it('rejects >3 reference images', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn(),
      pollTask: vi.fn(),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateCharacterExpression({
        characterName: 'X',
        expressionName: 'neutral',
        referenceImages: ['a', 'b', 'c', 'd'],
        expressionPrompt: 'neutral',
        gameDir,
        registryPath,
        client,
      }),
    ).rejects.toThrow(/at most 3/);
    expect(client.submitTask).not.toHaveBeenCalled();
  });

  it('marks error on failed task', async () => {
    const client: RunningHubClient = {
      submitTask: vi.fn().mockResolvedValue({ taskId: 'e3' }),
      pollTask: vi.fn().mockResolvedValue({ status: 'error', errorMessage: 'moderation' }),
    };
    const gameDir = join(dir, 'game');
    const registryPath = registryPathForGame(gameDir);

    await expect(
      generateCharacterExpression({
        characterName: 'X',
        expressionName: 'angry',
        referenceImages: ['https://cdn/x.png'],
        expressionPrompt: 'angry',
        gameDir,
        registryPath,
        client,
        sleep: async () => {},
        pollIntervalMs: 0,
      }),
    ).rejects.toThrow(/moderation/);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]!.status).toBe('error');
    expect(reloaded.entries[0]!.logicalKey).toBe('character:x:expr:angry');
  });
});
