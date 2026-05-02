import type { CommonToolContext } from '../../agents/common-tools.js';
import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
} from '../../agents/workspace-io.js';
import { parseWorkspaceUri } from '../../agents/workspace-index.js';
import { requireTier2Client, slugForFilename } from '../common/tier2-helpers.js';
import { generateCharacterExpression } from './generate-expression.js';
import { generateCharacterDynamicSprite } from './generate-dynamic-sprite.js';
import {
  loadRegistry,
  registryPathForGame,
  upsertRegistryEntry,
  type AssetRegistryEntry,
} from '../../assets/registry.js';
import {
  logicalKeyForCharacter,
  logicalKeyForCharacterDynamicSprite,
  logicalKeyForCharacterExpression,
} from '../../assets/logical-key.js';

interface ExpressionVariant {
  readonly expressionName: string;
  readonly imageUri: string;
  readonly updatedAt: string;
}

interface CharacterDoc {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
  readonly mainImageUri: string | null;
  readonly status: 'ready' | 'placeholder';
  readonly expressions?: ReadonlyArray<ExpressionVariant>;
  readonly dynamicSpriteUri?: string;
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
  const nextVisualDescription =
    typeof args.visualDescription === 'string'
      ? args.visualDescription
      : (existing?.visualDescription ?? '');

  // Dirty-state detection (§5.5.4 step 3): when an existing character's
  // visualDescription changes, the previously-generated main image / expressions /
  // dynamic sprite in the asset registry are stale. Flip those registry entries
  // back to 'placeholder' so the next coder rebuild renders Solid()/Image()
  // placeholders and the main-image task agent regenerates on demand. The
  // character doc's mainImageUri is preserved as audit history — matching v0.4
  // modifyCharacterAppearance semantics so the Coder path stays stable.
  const visualDescriptionChanged =
    existing !== undefined &&
    typeof existing.visualDescription === 'string' &&
    existing.visualDescription !== nextVisualDescription;

  const mainImageUri: string | null = hasMainImageUriInArgs
    ? typeof args.mainImageUri === 'string'
      ? args.mainImageUri
      : null
    : (existing?.mainImageUri ?? null);

  const merged: CharacterDoc = {
    name: (typeof args.name === 'string' ? args.name : existing?.name) ?? '(unnamed)',
    description:
      (typeof args.description === 'string' ? args.description : existing?.description) ?? '',
    visualDescription: nextVisualDescription,
    mainImageUri,
    status: mainImageUri ? 'ready' : 'placeholder',
    // Preserve expression / dynamic sprite URIs as audit history even when
    // visualDescription changes. The registry-side placeholder flip is what
    // actually forces Stage B to regenerate; keeping the URIs on the character
    // doc lets callers inspect the prior asset if they need to.
    ...(existing?.expressions ? { expressions: existing.expressions } : {}),
    ...(existing?.dynamicSpriteUri ? { dynamicSpriteUri: existing.dynamicSpriteUri } : {}),
  };

  await writeWorkspaceDoc(resolvedUri, ctx.gameDir, merged);

  let registryInvalidated = false;
  if (visualDescriptionChanged) {
    registryInvalidated = await markCharacterAssetsPlaceholder(ctx, merged.name);
  }

  ctx.logger.info('character_designer.create_or_update', {
    uri: resolvedUri,
    status: merged.status,
    visualDescriptionChanged,
    registryInvalidated,
  });
  // Deterministic short ack; see rationale in scene-designer/tools.ts.
  return {
    uri: resolvedUri,
    status: merged.status,
    saved: true,
    ...(visualDescriptionChanged ? { visualDescriptionChanged: true } : {}),
    ...(registryInvalidated ? { registryInvalidated: true } : {}),
  };
};

/**
 * Flip every asset-registry entry whose `logicalKey` begins with
 * `character:<slug>:` back to `status: 'placeholder'`, preserving the old
 * `realAssetLocalPath` as audit history. This is the Stage B dirty-state signal:
 * Coder's next `swap_asset_placeholder` / `write_game_project` round will
 * render the Solid()/Image() placeholder and the main-image task agent will
 * re-generate on the next character-designer handoff.
 *
 * Returns true if any entry was flipped — for logging / tool-result telemetry.
 */
async function markCharacterAssetsPlaceholder(
  ctx: CommonToolContext,
  characterName: string,
): Promise<boolean> {
  const registryPath = ctx.registryPath ?? registryPathForGame(ctx.gameDir);
  let registry;
  try {
    registry = await loadRegistry(registryPath);
  } catch (e) {
    // Missing registry dir on a fresh V5 project: nothing to invalidate.
    ctx.logger.warn('character_designer.markCharacterAssets.load_failed', {
      error: (e as Error).message,
    });
    return false;
  }
  const mainKey = logicalKeyForCharacter(characterName);
  const dynamicKey = logicalKeyForCharacterDynamicSprite(characterName);
  const mainKeyPrefix = `${mainKey.split(':').slice(0, 2).join(':')}:`; // character:<slug>:
  let changed = false;
  const now = new Date().toISOString();
  for (const entry of registry.entries) {
    if (!entry.logicalKey.startsWith(mainKeyPrefix)) continue;
    if (entry.status !== 'ready') continue;
    const invalidated: AssetRegistryEntry = {
      ...entry,
      status: 'placeholder',
      updatedAt: now,
    };
    await upsertRegistryEntry(registryPath, invalidated);
    changed = true;
    ctx.logger.info('character_designer.asset_marked_placeholder', {
      placeholderId: entry.placeholderId,
      logicalKey: entry.logicalKey,
      assetType: entry.assetType,
    });
  }
  // Silence unused-var lint: mainKey / dynamicKey are the documented
  // derivation of the prefix. Keep them referenced so future readers can trace
  // back to the logical-key helpers.
  void mainKey;
  void dynamicKey;
  return changed;
}

const generate_character_main_image: ToolExecutor = async () => ({
  error:
    'generate_character_main_image: v0.6 dispatches image generation via call_task_agent("character_main_image_generator", { characterUri })',
});

async function loadCharacterByNameOrUri(
  ctx: CommonToolContext,
  characterUri: string | null,
  characterName: string | null,
): Promise<{ readonly uri: string; readonly doc: CharacterDoc } | { readonly error: string }> {
  let uri = characterUri;
  if (!uri && characterName) {
    const slug = slugForFilename(characterName);
    uri = `workspace://character/${slug}`;
  }
  if (!uri) return { error: 'must provide characterUri or characterName' };
  const doc = await readWorkspaceDoc<CharacterDoc>(uri, ctx.gameDir);
  if (!doc) return { error: `character not found at ${uri}` };
  return { uri, doc };
}

const generate_character_expression: ToolExecutor = async (args, ctx) => {
  const expressionName = typeof args.expressionName === 'string' ? args.expressionName : null;
  const expressionPrompt = typeof args.expressionPrompt === 'string' ? args.expressionPrompt : null;
  const characterUri = typeof args.characterUri === 'string' ? args.characterUri : null;
  const characterName = typeof args.characterName === 'string' ? args.characterName : null;
  const extraRefs = Array.isArray(args.extraReferenceImages)
    ? (args.extraReferenceImages.filter((r) => typeof r === 'string') as string[])
    : [];

  if (!expressionName) return { error: 'generate_character_expression: expressionName required' };
  if (!expressionPrompt) return { error: 'generate_character_expression: expressionPrompt required' };

  const loaded = await loadCharacterByNameOrUri(ctx, characterUri, characterName);
  if ('error' in loaded) return { error: `generate_character_expression: ${loaded.error}` };
  const { uri: resolvedUri, doc: character } = loaded;
  if (!character.mainImageUri) {
    return {
      error: `generate_character_expression: character ${resolvedUri} has no mainImageUri — generate the main image first`,
    };
  }

  const required = requireTier2Client(ctx, 'generate_character_expression');
  if (!required.ok) return { error: required.error };

  const referenceImages = [character.mainImageUri, ...extraRefs].slice(0, 3);

  try {
    const result = await generateCharacterExpression({
      characterName: character.name,
      expressionName,
      referenceImages,
      expressionPrompt,
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const imageUri = result.entry.realAssetLocalPath ?? result.remoteUrl;
    const updatedVariants: ExpressionVariant[] = [
      ...(character.expressions ?? []).filter((v) => v.expressionName !== expressionName),
      { expressionName, imageUri, updatedAt: new Date().toISOString() },
    ];
    const updated: CharacterDoc = {
      ...character,
      expressions: updatedVariants,
    };
    await writeWorkspaceDoc(resolvedUri, ctx.gameDir, updated);
    ctx.logger.info('character_designer.generate_character_expression', {
      uri: resolvedUri,
      expressionName,
      imageUri,
    });
    return { uri: resolvedUri, expressionName, imageUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('character_designer.generate_character_expression', { error: msg });
    return { error: msg };
  }
};

const generate_character_dynamic_sprite: ToolExecutor = async (args, ctx) => {
  const characterUri = typeof args.characterUri === 'string' ? args.characterUri : null;
  const characterName = typeof args.characterName === 'string' ? args.characterName : null;
  const motionPrompt = typeof args.motionPrompt === 'string' ? args.motionPrompt : undefined;

  const loaded = await loadCharacterByNameOrUri(ctx, characterUri, characterName);
  if ('error' in loaded) return { error: `generate_character_dynamic_sprite: ${loaded.error}` };
  const { uri: resolvedUri, doc: character } = loaded;
  if (!character.mainImageUri) {
    return {
      error: `generate_character_dynamic_sprite: character ${resolvedUri} has no mainImageUri — generate the main image first`,
    };
  }

  const required = requireTier2Client(ctx, 'generate_character_dynamic_sprite');
  if (!required.ok) return { error: required.error };

  try {
    const result = await generateCharacterDynamicSprite({
      characterName: character.name,
      firstFrameImageUri: character.mainImageUri,
      ...(motionPrompt !== undefined ? { motionPrompt } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const videoUri = result.entry.realAssetLocalPath ?? result.remoteUrl;
    const updated: CharacterDoc = {
      ...character,
      dynamicSpriteUri: videoUri,
    };
    await writeWorkspaceDoc(resolvedUri, ctx.gameDir, updated);
    ctx.logger.info('character_designer.generate_character_dynamic_sprite', {
      uri: resolvedUri,
      videoUri,
    });
    return { uri: resolvedUri, videoUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('character_designer.generate_character_dynamic_sprite', { error: msg });
    return { error: msg };
  }
};

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
    {
      name: 'generate_character_expression',
      description:
        'Generate an expression variant (Nanobanana2 img2img) for a character and append it to ' +
        'character.expressions[]. Character must already have mainImageUri.',
      inputSchema: {
        type: 'object',
        properties: {
          characterUri: { type: 'string', description: 'Target character. Alternative: characterName.' },
          characterName: { type: 'string', description: 'Used to derive workspace://character/<slug>.' },
          expressionName: {
            type: 'string',
            description: 'Short slug-friendly name: "smile", "surprised", "blushing"…',
          },
          expressionPrompt: {
            type: 'string',
            description: 'Description of the target expression + pose.',
          },
          extraReferenceImages: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Up to 2 extra reference URLs (outfit / pose). Main image is always ref_image_1.',
          },
        },
        required: ['expressionName', 'expressionPrompt'],
      },
    },
    {
      name: 'generate_character_dynamic_sprite',
      description:
        'Generate an idle-animation video (Seedance2.0 image-to-video) for a character using its main image as the first frame. ' +
        'Writes dynamicSpriteUri back onto the Character doc.',
      inputSchema: {
        type: 'object',
        properties: {
          characterUri: { type: 'string' },
          characterName: { type: 'string' },
          motionPrompt: {
            type: 'string',
            description: 'What the character does in the clip; defaults to gentle idle motion.',
          },
        },
      },
    },
  ],
  executors: {
    create_or_update_character,
    generate_character_main_image,
    generate_character_expression,
    generate_character_dynamic_sprite,
  },
};

export type { CharacterDoc };
