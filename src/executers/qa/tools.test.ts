import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { qaTools } from './tools.js';

async function makeCtx(): Promise<CommonToolContext> {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-qa-'));
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

describe('qa.run_qa', () => {
  it('returns a structured result (skipped when no SDK is present)', async () => {
    const ctx = await makeCtx();
    const res = await qaTools.executors.run_qa!({}, ctx);
    expect(res).toHaveProperty('result');
    expect(['pass', 'fail', 'skipped']).toContain(res.result);
  });
});

describe('qa.kick_back_to_coder (v0.6 stub)', () => {
  it('returns stub error', async () => {
    const ctx = await makeCtx();
    const res = await qaTools.executors.kick_back_to_coder!({}, ctx);
    expect(res).toMatchObject({ error: expect.stringMatching(/v0\.6 not yet routed/) });
  });
});
