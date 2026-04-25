import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { appendPlannerMemory, loadPlannerMemories, formatMemoriesForPrompt } from './memory.js';

async function makeMemoryDir(): Promise<string> {
  return await mkdtemp(resolve(tmpdir(), 'v5-memory-'));
}

describe('appendPlannerMemory + loadPlannerMemories', () => {
  it('returns empty list when log does not exist', async () => {
    const dir = await makeMemoryDir();
    expect(await loadPlannerMemories(dir)).toEqual([]);
  });

  it('appends one entry and reads it back', async () => {
    const dir = await makeMemoryDir();
    await appendPlannerMemory(dir, {
      taskId: 'create-project',
      kind: 'finish',
      summary: 'Created project Sakura',
    });
    const entries = await loadPlannerMemories(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId: 'create-project',
      kind: 'finish',
      summary: 'Created project Sakura',
    });
    expect(entries[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves append order across multiple writes', async () => {
    const dir = await makeMemoryDir();
    await appendPlannerMemory(dir, { taskId: 't1', kind: 'plan', summary: 'plan-1' });
    await appendPlannerMemory(dir, { taskId: 't1', kind: 'finish', summary: 'done-1' });
    await appendPlannerMemory(dir, { taskId: 't2', kind: 'plan', summary: 'plan-2' });
    const entries = await loadPlannerMemories(dir);
    expect(entries.map((e) => e.summary)).toEqual(['plan-1', 'done-1', 'plan-2']);
  });

  it('writes JSONL format (one JSON per line)', async () => {
    const dir = await makeMemoryDir();
    await appendPlannerMemory(dir, { taskId: 't', kind: 'finish', summary: 'a' });
    await appendPlannerMemory(dir, { taskId: 't', kind: 'finish', summary: 'b' });
    const text = await readFile(resolve(dir, 'log.jsonl'), 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('skips malformed JSONL lines gracefully', async () => {
    const dir = await makeMemoryDir();
    await appendPlannerMemory(dir, { taskId: 't', kind: 'finish', summary: 'ok' });
    // Manually append a garbage line.
    const { appendFile } = await import('node:fs/promises');
    await appendFile(resolve(dir, 'log.jsonl'), 'not-json\n', 'utf8');
    await appendPlannerMemory(dir, { taskId: 't', kind: 'finish', summary: 'also-ok' });
    const entries = await loadPlannerMemories(dir);
    expect(entries.map((e) => e.summary)).toEqual(['ok', 'also-ok']);
  });
});

describe('formatMemoriesForPrompt', () => {
  it('returns placeholder text for empty list', () => {
    expect(formatMemoriesForPrompt([])).toContain('no prior tasks');
  });

  it('formats finish entries only (plan entries are audit trail, not signal)', () => {
    const entries = [
      {
        taskId: 't1',
        kind: 'plan' as const,
        summary: 'planning...',
        timestamp: '2026-04-25T10:00:00.000Z',
      },
      {
        taskId: 't1',
        kind: 'finish' as const,
        summary: 'created project Sakura',
        timestamp: '2026-04-25T10:05:00.000Z',
      },
      {
        taskId: 't2',
        kind: 'finish' as const,
        summary: 'created character Baiying',
        timestamp: '2026-04-25T10:10:00.000Z',
      },
    ];
    const text = formatMemoriesForPrompt(entries);
    expect(text).toContain('created project Sakura');
    expect(text).toContain('created character Baiying');
    expect(text).not.toContain('planning...');
  });
});
