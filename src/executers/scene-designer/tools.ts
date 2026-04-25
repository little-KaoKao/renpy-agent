import { stubTool, type PocToolSet, type ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../../agents/workspace-io.js';
import { parseWorkspaceUri } from '../../agents/workspace-index.js';

interface SceneDoc {
  readonly name: string;
  readonly description: string;
  readonly backgroundUri: string | null;
  readonly status: 'ready' | 'placeholder';
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

const create_or_update_scene: ToolExecutor = async (args, ctx) => {
  const uri = typeof args.uri === 'string' ? args.uri : null;
  const name = typeof args.name === 'string' ? args.name : null;

  let resolvedUri: string;
  if (uri) {
    try {
      parseWorkspaceUri(uri);
    } catch (e) {
      return { error: (e as Error).message };
    }
    resolvedUri = uri;
  } else if (name) {
    const slug = slugify(name);
    if (!slug) return { error: 'create_or_update_scene: name produced empty slug' };
    resolvedUri = `workspace://scene/${slug}`;
  } else {
    return { error: 'create_or_update_scene: must provide uri or name' };
  }

  const existing = await readWorkspaceDoc<SceneDoc>(resolvedUri, ctx.gameDir);
  const hasBgInArgs = 'backgroundUri' in args;
  const backgroundUri = hasBgInArgs
    ? typeof args.backgroundUri === 'string'
      ? args.backgroundUri
      : null
    : (existing?.backgroundUri ?? null);

  const merged: SceneDoc = {
    name: (typeof args.name === 'string' ? args.name : existing?.name) ?? '(unnamed)',
    description:
      (typeof args.description === 'string' ? args.description : existing?.description) ?? '',
    backgroundUri,
    status: backgroundUri ? 'ready' : 'placeholder',
  };

  await writeWorkspaceDoc(resolvedUri, ctx.gameDir, merged);
  ctx.logger.info('scene_designer.create_or_update', {
    uri: resolvedUri,
    status: merged.status,
  });
  return { uri: resolvedUri, ...merged };
};

const generate_scene_background: ToolExecutor = async () => ({
  error:
    'generate_scene_background: v0.6 dispatches image generation via call_task_agent("scene_background_generator", { sceneUri })',
});

const propStub = stubTool('generate_prop', 'Generate a prop sprite (Tier 2, v0.7).');
const timeVariantStub = stubTool(
  'generate_scene_time_variant',
  'Generate a time-of-day variant of a scene background (Tier 2, v0.7).',
);

export const sceneDesignerTools: PocToolSet = {
  schemas: [
    {
      name: 'create_or_update_scene',
      description:
        'Create or update a Scene document (workspace://scene/<slug>). ' +
        'Setting backgroundUri=null flips status back to "placeholder".',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          backgroundUri: { type: ['string', 'null'] },
        },
      },
    },
    {
      name: 'generate_scene_background',
      description:
        'Hint tool: v0.6 routes background image generation through call_task_agent("scene_background_generator").',
      inputSchema: {
        type: 'object',
        properties: { sceneUri: { type: 'string' } },
        required: ['sceneUri'],
      },
    },
    propStub.schema,
    timeVariantStub.schema,
  ],
  executors: {
    create_or_update_scene,
    generate_scene_background,
    generate_prop: propStub.executor,
    generate_scene_time_variant: timeVariantStub.executor,
  },
};

export type { SceneDoc };
