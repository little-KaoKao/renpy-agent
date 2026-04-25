// V5 per-URI workspace IO. Sits on top of workspace-index.ts (which handles
// URI -> path resolution) and centralises the "read doc by URI / write doc by
// URI" pattern. POC tool implementations call these helpers; they MUST NOT
// touch src/pipeline/workspace.ts, which is the v0.2 bundled-JSON IO layer.

import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  parseWorkspaceUri,
  resolveUriToPath,
  workspaceDirForGame,
  type WorkspaceKind,
} from './workspace-index.js';

export async function readWorkspaceDoc<T>(uri: string, gameDir: string): Promise<T | undefined> {
  const path = resolveUriToPath(uri, gameDir);
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function writeWorkspaceDoc(
  uri: string,
  gameDir: string,
  doc: unknown,
): Promise<string> {
  const path = resolveUriToPath(uri, gameDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return path;
}

export interface CollectionListResult {
  readonly uri: string;
  readonly slug: string;
  readonly path: string;
}

export async function listWorkspaceCollection(
  kind: Extract<WorkspaceKind, 'character' | 'scene'>,
  gameDir: string,
): Promise<ReadonlyArray<CollectionListResult>> {
  const wsDir = workspaceDirForGame(gameDir);
  const subdir = kind === 'character' ? 'characters' : 'scenes';
  const dir = resolve(wsDir, subdir);
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const slug = f.slice(0, -'.json'.length);
      return {
        uri: `workspace://${kind}/${slug}`,
        slug,
        path: resolve(dir, f),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function slugFromUri(uri: string): string | null {
  return parseWorkspaceUri(uri).slug;
}
