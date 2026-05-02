import type { CommonToolContext } from '../../agents/common-tools.js';
import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../../agents/workspace-io.js';

interface ProjectDoc {
  readonly title: string;
  readonly genre: string;
  readonly tone: string;
  readonly status: 'ready';
}

interface ChapterDoc {
  readonly projectUri: string;
  readonly outline: string;
  readonly status: 'ready';
}

const create_project: ToolExecutor = async (args, ctx) => {
  const title = typeof args.title === 'string' ? args.title : '';
  const genre = typeof args.genre === 'string' ? args.genre : '';
  const tone = typeof args.tone === 'string' ? args.tone : '';
  if (!title || !genre || !tone) {
    return { error: 'create_project: title, genre, tone all required and non-empty' };
  }
  const doc: ProjectDoc = { title, genre, tone, status: 'ready' };
  await writeWorkspaceDoc('workspace://project', ctx.gameDir, doc);
  ctx.logger.info('producer.create_project', { title });
  // Deterministic short ack — see rationale in scene-designer/tools.ts
  // (M6 smoke found LLMs re-issuing upserts when the ack echoed the full doc).
  return { uri: 'workspace://project', status: 'ready', saved: true };
};

const create_chapter: ToolExecutor = async (args, ctx) => {
  const projectUri = typeof args.projectUri === 'string' ? args.projectUri : '';
  const outline = typeof args.outline === 'string' ? args.outline : '';
  if (!projectUri || !outline) {
    return { error: 'create_chapter: projectUri and outline required' };
  }
  const project = await readWorkspaceDoc<ProjectDoc>(projectUri, ctx.gameDir);
  if (!project) {
    return { error: `create_chapter: project not found at ${projectUri}` };
  }
  const doc: ChapterDoc = { projectUri, outline, status: 'ready' };
  await writeWorkspaceDoc('workspace://chapter', ctx.gameDir, doc);
  ctx.logger.info('producer.create_chapter', { projectUri });
  return { uri: 'workspace://chapter', status: 'ready', saved: true };
};

export const producerTools: PocToolSet = {
  schemas: [
    {
      name: 'create_project',
      description: 'Create or overwrite the project metadata (title/genre/tone).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          genre: { type: 'string' },
          tone: { type: 'string' },
        },
        required: ['title', 'genre', 'tone'],
      },
    },
    {
      name: 'create_chapter',
      description: 'Create or overwrite the chapter metadata (outline + reference to project).',
      inputSchema: {
        type: 'object',
        properties: {
          projectUri: { type: 'string' },
          outline: { type: 'string' },
        },
        required: ['projectUri', 'outline'],
      },
    },
  ],
  executors: { create_project, create_chapter },
};

// Re-export for tests / future consumers.
export type { ProjectDoc, ChapterDoc };
