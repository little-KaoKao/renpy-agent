import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MEMORY_LOG_FILENAME = 'log.jsonl';

export type PlannerMemoryKind = 'plan' | 'finish';

export interface PlannerMemoryInput {
  readonly taskId: string;
  readonly kind: PlannerMemoryKind;
  readonly summary: string;
}

export interface PlannerMemoryEntry extends PlannerMemoryInput {
  readonly timestamp: string;
}

export async function appendPlannerMemory(
  memoryDir: string,
  entry: PlannerMemoryInput,
): Promise<PlannerMemoryEntry> {
  await mkdir(memoryDir, { recursive: true });
  const full: PlannerMemoryEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(full) + '\n';
  await appendFile(resolve(memoryDir, MEMORY_LOG_FILENAME), line, 'utf8');
  return full;
}

export async function loadPlannerMemories(
  memoryDir: string,
): Promise<ReadonlyArray<PlannerMemoryEntry>> {
  const path = resolve(memoryDir, MEMORY_LOG_FILENAME);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: PlannerMemoryEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line) as PlannerMemoryEntry);
    } catch {
      // Skip malformed lines — log files can get partial writes on crash.
    }
  }
  return out;
}

export function formatMemoriesForPrompt(
  entries: ReadonlyArray<PlannerMemoryEntry>,
): string {
  const finishes = entries.filter((e) => e.kind === 'finish');
  if (finishes.length === 0) {
    return '(no prior tasks completed)';
  }
  return finishes.map((e) => `- [${e.taskId}] ${e.summary}`).join('\n');
}
