import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type WorkspaceKind =
  | 'project'
  | 'chapter'
  | 'character'
  | 'scene'
  | 'script'
  | 'storyboard'
  | 'bgmTrack'
  | 'voiceLine'
  | 'sfx'
  | 'uiDesign'
  | 'cutscene'
  | 'prop'
  | 'bugReport';

const SINGLETON_KINDS = new Set<WorkspaceKind>(['project', 'chapter', 'script', 'storyboard']);
type CollectionKind = Exclude<WorkspaceKind, 'project' | 'chapter' | 'script' | 'storyboard'>;
const COLLECTION_KINDS = new Set<WorkspaceKind>([
  'character',
  'scene',
  'bgmTrack',
  'voiceLine',
  'sfx',
  'uiDesign',
  'cutscene',
  'prop',
  'bugReport',
]);
const ALL_KINDS = new Set<WorkspaceKind>([...SINGLETON_KINDS, ...COLLECTION_KINDS]);

const COLLECTION_DIRNAME: Record<CollectionKind, string> = {
  character: 'characters',
  scene: 'scenes',
  bgmTrack: 'bgm_tracks',
  voiceLine: 'voice_lines',
  sfx: 'sfx',
  uiDesign: 'ui_designs',
  cutscene: 'cutscenes',
  prop: 'props',
  bugReport: 'bug_reports',
};

export interface ParsedUri {
  readonly kind: WorkspaceKind;
  readonly slug: string | null;
}

export function parseWorkspaceUri(uri: string): ParsedUri {
  const match = /^workspace:\/\/([a-zA-Z]+)(?:\/([A-Za-z0-9_-]+))?$/.exec(uri);
  if (!match) {
    throw new Error(`invalid workspace:// URI: ${uri}`);
  }
  const kind = match[1] as WorkspaceKind;
  const slug = match[2] ?? null;
  if (!ALL_KINDS.has(kind)) {
    throw new Error(`unknown kind "${kind}" in URI ${uri}`);
  }
  return { kind, slug };
}

export function workspaceDirForGame(gameDir: string): string {
  return resolve(dirname(gameDir), 'workspace');
}

export function resolveUriToPath(uri: string, gameDir: string): string {
  const { kind, slug } = parseWorkspaceUri(uri);
  const wsDir = workspaceDirForGame(gameDir);
  if (SINGLETON_KINDS.has(kind)) {
    return resolve(wsDir, `${kind}.json`);
  }
  if (!slug) {
    throw new Error(`URI ${uri} requires a slug (kind=${kind})`);
  }
  const subdir = COLLECTION_DIRNAME[kind as CollectionKind];
  return resolve(wsDir, subdir, `${slug}.json`);
}

export interface WorkspaceIndexEntry {
  readonly uri: string;
  readonly kind: WorkspaceKind;
  readonly title: string;
  readonly status: string;
  readonly path: string;
}

export interface WorkspaceIndex {
  readonly entries: ReadonlyArray<WorkspaceIndexEntry>;
  readonly tier2Available: boolean;
  formatForPrompt(): string;
}

interface LooseDoc {
  readonly title?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
}

export async function buildWorkspaceIndex(gameDir: string): Promise<WorkspaceIndex> {
  const wsDir = workspaceDirForGame(gameDir);
  const entries: WorkspaceIndexEntry[] = [];
  const tier2Available = Boolean(process.env.RUNNINGHUB_API_KEY);

  for (const kind of SINGLETON_KINDS) {
    const path = resolve(wsDir, `${kind}.json`);
    const doc = await tryReadJson<LooseDoc>(path);
    if (!doc) continue;
    entries.push({
      uri: `workspace://${kind}`,
      kind,
      title: extractTitle(doc),
      status: extractStatus(doc),
      path,
    });
  }

  for (const kind of COLLECTION_KINDS) {
    const subdir = COLLECTION_DIRNAME[kind as CollectionKind];
    const collectionDir = resolve(wsDir, subdir);
    const files = await tryReadDir(collectionDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const slug = file.slice(0, -'.json'.length);
      const path = resolve(collectionDir, file);
      const doc = await tryReadJson<LooseDoc>(path);
      if (!doc) continue;
      entries.push({
        uri: `workspace://${kind}/${slug}`,
        kind,
        title: extractTitle(doc),
        status: extractStatus(doc),
        path,
      });
    }
  }

  entries.sort((a, b) => a.uri.localeCompare(b.uri));

  return {
    entries,
    tier2Available,
    formatForPrompt(): string {
      if (entries.length === 0) return '(workspace is empty)';
      const lines = entries.map(
        (e) => `- ${e.uri}  [${e.kind}, ${e.status}]  ${e.title}`,
      );
      const header = tier2Available
        ? 'tier2Available: true\n\n'
        : 'tier2Available: false\n\n';
      return header + lines.join('\n');
    },
  };
}

function extractTitle(doc: LooseDoc): string {
  if (typeof doc.title === 'string' && doc.title.length > 0) return doc.title;
  if (typeof doc.name === 'string' && doc.name.length > 0) return doc.name;
  return '(untitled)';
}

function extractStatus(doc: LooseDoc): string {
  if (typeof doc.status === 'string' && doc.status.length > 0) return doc.status;
  return 'unknown';
}

async function tryReadJson<T>(path: string): Promise<T | undefined> {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

async function tryReadDir(path: string): Promise<string[]> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return [];
    return await readdir(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
