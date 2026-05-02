import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import { qaTools } from './tools.js';

async function makeCtx(
  overrides: Partial<CommonToolContext> = {},
): Promise<CommonToolContext> {
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
    ...overrides,
  };
}

async function seedWorkspaceWith10Docs(gameDir: string): Promise<void> {
  const wsDir = resolve(gameDir, '..', 'workspace');
  await mkdir(wsDir, { recursive: true });
  // 4 singletons
  for (const kind of ['project', 'chapter', 'script', 'storyboard']) {
    await writeFile(
      resolve(wsDir, `${kind}.json`),
      JSON.stringify({ title: `${kind} doc`, status: 'draft' }),
      'utf8',
    );
  }
  // 3 characters
  await mkdir(resolve(wsDir, 'characters'), { recursive: true });
  for (const slug of ['alice', 'bob', 'carol']) {
    await writeFile(
      resolve(wsDir, 'characters', `${slug}.json`),
      JSON.stringify({ name: slug, status: 'draft' }),
      'utf8',
    );
  }
  // 3 scenes
  await mkdir(resolve(wsDir, 'scenes'), { recursive: true });
  for (const slug of ['cafe', 'park', 'classroom']) {
    await writeFile(
      resolve(wsDir, 'scenes', `${slug}.json`),
      JSON.stringify({ title: slug, status: 'draft' }),
      'utf8',
    );
  }
}

describe('qa.run_qa', () => {
  it('returns a structured result (skipped when no SDK is present)', async () => {
    // Satisfy the read-quota (min 5) so we reach the actual lint path.
    const ctx = await makeCtx({ readFromUriCount: () => 5 });
    const res = await qaTools.executors.run_qa!({}, ctx);
    expect(res).toHaveProperty('result');
    expect(['pass', 'fail', 'skipped']).toContain(res.result);
  }, 30_000);

  it('rejects when readFromUri count is below the workspace-size quota', async () => {
    const ctx = await makeCtx({ readFromUriCount: () => 4 });
    await seedWorkspaceWith10Docs(ctx.gameDir);
    const res = await qaTools.executors.run_qa!({}, ctx);
    expect(res).toMatchObject({
      error: expect.stringMatching(/read.*docs.*before.*run_qa/i),
      retry: false,
      guidance: expect.stringMatching(/read_from_uri/),
    });
    expect(res).toHaveProperty('minRequiredReads', 5);
    expect(res).toHaveProperty('actualReads', 4);
  });

  it('allows run_qa once the readFromUri count meets the quota', async () => {
    const ctx = await makeCtx({ readFromUriCount: () => 8 });
    await seedWorkspaceWith10Docs(ctx.gameDir);
    const res = await qaTools.executors.run_qa!({}, ctx);
    // SDK absent in test env → result=skipped, but NOT an error about reads.
    expect(res).not.toHaveProperty('retry');
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
