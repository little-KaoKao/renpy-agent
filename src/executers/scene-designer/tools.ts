import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../../agents/workspace-io.js';
import { parseWorkspaceUri } from '../../agents/workspace-index.js';
import { requireTier2Client, slugForFilename } from '../common/tier2-helpers.js';
import { generatePropImage } from './generate-prop.js';
import { generateSceneTimeVariant } from './generate-time-variant.js';

interface TimeVariantEntry {
  readonly timeOfDay: string;
  readonly lightingDescription: string;
  readonly imageUri: string;
  readonly updatedAt: string;
}

interface SceneDoc {
  readonly name: string;
  readonly description: string;
  readonly backgroundUri: string | null;
  readonly status: 'ready' | 'placeholder';
  readonly timeVariants?: ReadonlyArray<TimeVariantEntry>;
}

interface PropDoc {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly imageUri: string;
  readonly sceneUri?: string;
  readonly status: 'ready';
  readonly updatedAt: string;
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
    ...(existing?.timeVariants ? { timeVariants: existing.timeVariants } : {}),
  };

  await writeWorkspaceDoc(resolvedUri, ctx.gameDir, merged);
  ctx.logger.info('scene_designer.create_or_update', {
    uri: resolvedUri,
    status: merged.status,
  });
  // Return a short, deterministic ack so the LLM sees the same bytes each time
  // a duplicate upsert would land — signals "already saved, stop re-calling".
  // M6 smoke (2026-05-02) caught the LLM re-issuing 9×2 create_or_update_scene
  // calls because the previous verbose return made each result look novel.
  return { uri: resolvedUri, status: merged.status, saved: true };
};

const generate_scene_background: ToolExecutor = async () => ({
  error:
    'generate_scene_background: v0.6 dispatches image generation via call_task_agent("scene_background_generator", { sceneUri })',
});

const generate_prop: ToolExecutor = async (args, ctx) => {
  const propName = typeof args.propName === 'string' ? args.propName : null;
  const description = typeof args.description === 'string' ? args.description : null;
  const sceneUri = typeof args.sceneUri === 'string' ? args.sceneUri : null;
  const styleHint = typeof args.styleHint === 'string' ? args.styleHint : undefined;

  if (!propName) return { error: 'generate_prop: propName required' };
  if (!description) return { error: 'generate_prop: description required' };

  const required = requireTier2Client(ctx, 'generate_prop');
  if (!required.ok) return { error: required.error };

  if (sceneUri) {
    // Optional context — validate URI shape but tolerate missing scene.
    try {
      parseWorkspaceUri(sceneUri);
    } catch (e) {
      return { error: `generate_prop: invalid sceneUri — ${(e as Error).message}` };
    }
  }

  const targetUri = `workspace://prop/${slugForFilename(propName)}`;

  try {
    const result = await generatePropImage({
      propName,
      description,
      ...(styleHint !== undefined ? { styleHint } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const imageUri = result.entry.realAssetLocalPath ?? result.remoteUrl;
    const doc: PropDoc = {
      uri: targetUri,
      name: propName,
      description,
      imageUri,
      ...(sceneUri ? { sceneUri } : {}),
      status: 'ready',
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
    ctx.logger.info('scene_designer.generate_prop', { uri: targetUri, imageUri });
    return { uri: targetUri, imageUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('scene_designer.generate_prop', { error: msg });
    return { error: msg };
  }
};

const generate_scene_time_variant: ToolExecutor = async (args, ctx) => {
  const sceneUri = typeof args.sceneUri === 'string' ? args.sceneUri : null;
  const sceneName = typeof args.sceneName === 'string' ? args.sceneName : null;
  const timeOfDay = typeof args.timeOfDay === 'string' ? args.timeOfDay : null;
  const lightingDescription =
    typeof args.lightingDescription === 'string' ? args.lightingDescription : '';
  const styleHint = typeof args.styleHint === 'string' ? args.styleHint : undefined;

  if (!timeOfDay) return { error: 'generate_scene_time_variant: timeOfDay required' };

  let resolvedUri = sceneUri;
  if (!resolvedUri && sceneName) resolvedUri = `workspace://scene/${slugForFilename(sceneName)}`;
  if (!resolvedUri) return { error: 'generate_scene_time_variant: sceneUri or sceneName required' };

  const scene = await readWorkspaceDoc<SceneDoc>(resolvedUri, ctx.gameDir);
  if (!scene) return { error: `generate_scene_time_variant: scene not found at ${resolvedUri}` };

  const required = requireTier2Client(ctx, 'generate_scene_time_variant');
  if (!required.ok) return { error: required.error };

  try {
    const result = await generateSceneTimeVariant({
      sceneName: scene.name,
      baseDescription: scene.description,
      timeOfDay,
      ...(lightingDescription ? { lightingDescription } : {}),
      ...(styleHint !== undefined ? { styleHint } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const imageUri = result.entry.realAssetLocalPath ?? result.remoteUrl;
    const updatedVariants: TimeVariantEntry[] = [
      ...(scene.timeVariants ?? []).filter((v) => v.timeOfDay !== timeOfDay),
      {
        timeOfDay,
        lightingDescription,
        imageUri,
        updatedAt: new Date().toISOString(),
      },
    ];
    const updated: SceneDoc = {
      ...scene,
      timeVariants: updatedVariants,
    };
    await writeWorkspaceDoc(resolvedUri, ctx.gameDir, updated);
    ctx.logger.info('scene_designer.generate_scene_time_variant', {
      uri: resolvedUri,
      timeOfDay,
      imageUri,
    });
    return { uri: resolvedUri, timeOfDay, imageUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('scene_designer.generate_scene_time_variant', { error: msg });
    return { error: msg };
  }
};

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
    {
      name: 'generate_prop',
      description:
        'Generate a prop sprite (Nanobanana2 txt2img) and persist workspace://prop/<slug>. ' +
        'Optional sceneUri attaches the prop to a scene for later layout.',
      inputSchema: {
        type: 'object',
        properties: {
          propName: { type: 'string' },
          description: { type: 'string' },
          sceneUri: { type: 'string' },
          styleHint: { type: 'string' },
        },
        required: ['propName', 'description'],
      },
    },
    {
      name: 'generate_scene_time_variant',
      description:
        'Generate a time-of-day variant of a scene background and append it to scene.timeVariants[]. ' +
        'Requires the scene document to exist (via create_or_update_scene first).',
      inputSchema: {
        type: 'object',
        properties: {
          sceneUri: { type: 'string' },
          sceneName: { type: 'string' },
          timeOfDay: {
            type: 'string',
            description: "e.g. 'dusk', 'night', 'dawn', '傍晚', '深夜'.",
          },
          lightingDescription: { type: 'string' },
          styleHint: { type: 'string' },
        },
        required: ['timeOfDay'],
      },
    },
  ],
  executors: {
    create_or_update_scene,
    generate_scene_background,
    generate_prop,
    generate_scene_time_variant,
  },
};

export type { SceneDoc };
