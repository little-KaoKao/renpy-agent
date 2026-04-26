import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileLogger, logsDirForGame } from './logger.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'renpy-logger-'));
}

async function readLines(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('createFileLogger', () => {
  it('creates the log dir and writes newline-delimited JSON', async () => {
    const tmp = await tempDir();
    try {
      const logDir = join(tmp, 'logs');
      const logger = createFileLogger(logDir, {
        alsoConsole: false,
        now: new Date('2026-04-26T10:00:00.123Z'),
      });
      expect(logger.filePath).toBe(
        join(logDir, '2026-04-26T10-00-00-123Z.jsonl'),
      );

      logger.info('hello', { stage: 'planner' });
      logger.emit({ type: 'tool_use', stage: 'writer', data: { tool: 'draft_script' } });
      logger.error('boom');
      await logger.flush();

      const lines = await readLines(logger.filePath);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatchObject({
        type: 'info',
        message: 'hello',
        data: { stage: 'planner' },
      });
      expect(typeof lines[0]!.ts).toBe('string');
      expect(lines[1]).toMatchObject({
        type: 'tool_use',
        stage: 'writer',
        data: { tool: 'draft_script' },
      });
      expect(lines[2]).toMatchObject({ type: 'error', message: 'boom' });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('serializes concurrent writes without interleaving JSON lines', async () => {
    const tmp = await tempDir();
    try {
      const logger = createFileLogger(tmp, { alsoConsole: false });
      for (let i = 0; i < 50; i++) {
        logger.emit({ type: 'tool_use', data: { i } });
      }
      await logger.flush();

      const lines = await readLines(logger.filePath);
      expect(lines).toHaveLength(50);
      for (let i = 0; i < 50; i++) {
        expect((lines[i]!.data as { i: number }).i).toBe(i);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('does not throw when the target dir cannot be created', async () => {
    // Point at a path whose parent is a regular file so mkdir -p fails.
    const tmp = await tempDir();
    try {
      const badParent = join(tmp, 'file.txt');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(badParent, 'not a dir');
      const logger = createFileLogger(join(badParent, 'logs'), { alsoConsole: false });
      expect(() => logger.info('still alive')).not.toThrow();
      await expect(logger.flush()).resolves.toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('logsDirForGame', () => {
  it('resolves <gameRoot>/logs next to <gameRoot>/game', () => {
    const dir = logsDirForGame('/tmp/project/runtime/games/my-story/game');
    // Normalise separators: resolve/join on Windows returns backslashes, but the
    // relative tail we care about is stable.
    expect(dir.replace(/\\/g, '/')).toMatch(
      /\/runtime\/games\/my-story\/logs$/,
    );
  });
});
