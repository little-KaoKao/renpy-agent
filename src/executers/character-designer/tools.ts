import type { CommonToolContext } from '../../agents/common-tools.js';
import { stubTool, type PocToolSet, type ToolExecutor } from '../../agents/tool-schema.js';
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
} from '../../agents/workspace-io.js';
import { parseWorkspaceUri } from '../../agents/workspace-index.js';

interface CharacterDoc {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
  readonly mainImageUri: string | null;
  readonly status: 'ready' | 'placeholder';
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

const create_or_update_character: ToolExecutor = async (args, ctx) => {
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
    if (!slug) return { error: 'create_or_update_character: name produced empty slug' };
    resolvedUri = `workspace://character/${slug}`;
  } else {
    return { error: 'create_or_update_character: must provide uri or name' };
  }

  const existing = await readWorkspaceDoc<CharacterDoc>(resolvedUri, ctx.gameDir);
  const hasMainImageUriInArgs = 'mainImageUri' in args;
  const mainImageUri = hasMainImageUriInArgs
    ? typeof args.mainImageUri === 'string'
      ? args.mainImageUri
      : null
    : (existing?.mainImageUri ?? null);

  const merged: CharacterDoc = {
    name: (typeof args.name === 'string' ? args.name : existing?.name) ?? '(unnamed)',
    description:
      (typeof args.description === 'string' ? args.description : existing?.description) ?? '',
    visualDescription:
      (typeof args.visualDescription === 'string'
        ? args.visualDescription
        : existing?.visualDescription) ?? '',
    mainImageUri,
    status: mainImageUri ? 'ready' : 'placeholder',
  };

  await writeWorkspaceDoc(resolvedUri, ctx.gameDir, merged);
  ctx.logger.info('character_designer.create_or_update', {
    uri: resolvedUri,
    status: merged.status,
  });
  return { uri: resolvedUri, ...merged };
};

const generate_character_main_image: ToolExecutor = async () => ({
  error:
    'generate_character_main_image: v0.6 dispatches image generation via call_task_agent("character_main_image_generator", { characterUri })',
});

const expressionStub = stubTool(
  'generate_character_expression',
  'Generate a character expression sprite (Tier 2, v0.7).',
);
const dynamicSpriteStub = stubTool(
  'generate_character_dynamic_sprite',
  'Generate a character idle-animation sprite (Tier 2, v0.7).',
);

export const characterDesignerTools: PocToolSet = {
  schemas: [
    {
      name: 'create_or_update_character',
      description:
        'Create or update a Character document (workspace://character/<slug>). ' +
        'Setting mainImageUri=null flips status back to "placeholder" so the image will be regenerated.',
      inputSchema: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Optional; required for updates.' },
          name: { type: 'string', description: 'Required on first create; produces the slug.' },
          description: { type: 'string' },
          visualDescription: { type: 'string' },
          mainImageUri: {
            type: ['string', 'null'],
            description:
              'Optional. Pass null to clear and force a regeneration via the main image task agent.',
          },
        },
      },
    },
    {
      name: 'generate_character_main_image',
      description:
        'Hint tool: v0.6 routes image generation through call_task_agent("character_main_image_generator").',
      inputSchema: {
        type: 'object',
        properties: { characterUri: { type: 'string' } },
        required: ['characterUri'],
      },
    },
    expressionStub.schema,
    dynamicSpriteStub.schema,
  ],
  executors: {
    create_or_update_character,
    generate_character_main_image,
    generate_character_expression: expressionStub.executor,
    generate_character_dynamic_sprite: dynamicSpriteStub.executor,
  },
};

export type { CharacterDoc };
