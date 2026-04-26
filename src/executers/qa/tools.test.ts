import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
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
  }, 30_000);
});

describe('qa.kick_back_to_coder', () => {
  it('errors when description missing', async () => {
    const ctx = await makeCtx();
    const res = await qaTools.executors.kick_back_to_coder!({}, ctx);
    expect(res).toMatchObject({ error: expect.stringMatching(/description required/) });
  });

  it('errors on unknown severity', async () => {
    const ctx = await makeCtx();
    const res = await qaTools.executors.kick_back_to_coder!(
      { severity: 'catastrophic', description: 'x' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/severity/i) });
  });

  it('files a BugReport under workspace://bugReport/<id> and returns URI', async () => {
    const ctx = await makeCtx();
    const res = (await qaTools.executors.kick_back_to_coder!(
      {
        severity: 'high',
        description: 'voice offset by one line',
        shotNumber: 3,
        stepsToReproduce: ['open chapter 1', 'play shot 3'],
      },
      ctx,
    )) as { uri: string; severity: string; status: string };
    expect(res.status).toBe('filed');
    expect(res.severity).toBe('high');
    expect(res.uri).toMatch(/^workspace:\/\/bugReport\/qa_/);
    const slug = res.uri.replace('workspace://bugReport/', '');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'bug_reports', `${slug}.json`),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({
      uri: res.uri,
      severity: 'high',
      shotNumber: 3,
      description: 'voice offset by one line',
    });
    expect(doc.stepsToReproduce).toEqual(['open chapter 1', 'play shot 3']);
  });
});
