// character_main_image_generator — v0.7 concrete task agent.
//
// Input shape:
//   { characterUri: string, slug?: string, prompt?: string, DRY_RUN?: boolean }
// - `characterUri` required — we read the Character doc to get name + visual
//   description (fallback prompt source) and the slug the downstream file path
//   should use.
// - `slug` optional — overrides the slug derived from the doc name. Useful
//   when the Planner wants to pin a deterministic file path that doesn't match
//   slugForFilename(name).
// - `prompt` optional — if the Planner already expanded via
//   character_prompt_expander, reuse that prompt so we don't re-roll wording.
//   When absent we fall back to doc.visualDescription through
//   buildCharacterMainPrompt.
//
// Output: { status: 'ready' | 'error' | 'dry_run', localPath?: string,
//   remoteUrl?: string, byteLength?: number, error?: string, uri }.
//
// DRY_RUN: no network call; synthesises a deterministic mock URI + local path
// and returns a `status: 'dry_run'` record. Asset registry is NOT touched —
// that would hide the placeholder status from coder/QA downstream.

import type { TaskAgentFn } from '../../agents/common-tools.js';
import { readWorkspaceDoc } from '../../agents/workspace-io.js';
import { generateCharacterMainImage } from '../character-designer/generate-main-image.js';
import { requireTier2Client, slugForFilename } from '../common/tier2-helpers.js';
import { isDryRun } from './shared.js';

interface CharacterDocMin {
  readonly name?: string;
  readonly visualDescription?: string;
}

export const characterMainImageGenerator: TaskAgentFn = async (input, ctx) => {
  const characterUri = typeof input.characterUri === 'string' ? input.characterUri : null;
  if (!characterUri) {
    return {
      error: 'character_main_image_generator: characterUri is required',
    };
  }

  const doc = await readWorkspaceDoc<CharacterDocMin>(characterUri, ctx.gameDir);
  if (!doc) {
    return {
      error: `character_main_image_generator: character document not found at ${characterUri}`,
    };
  }
  const characterName = typeof doc.name === 'string' ? doc.name : null;
  const visualDescription = typeof doc.visualDescription === 'string' ? doc.visualDescription : '';
  if (!characterName) {
    return {
      error: `character_main_image_generator: character at ${characterUri} has no name`,
    };
  }

  const slugOverride = typeof input.slug === 'string' && input.slug.length > 0 ? input.slug : null;
  const slug = slugOverride ?? slugForFilename(characterName);

  if (isDryRun(input)) {
    const mockRemote = `https://dry-run.invalid/character/${slug}.png`;
    const mockLocal = `images/char/${slug}.png`;
    ctx.logger.info('character_main_image_generator.dry_run', {
      characterUri,
      slug,
    });
    return {
      status: 'dry_run',
      uri: characterUri,
      slug,
      remoteUrl: mockRemote,
      localPath: mockLocal,
      dryRun: true,
    };
  }

  const required = requireTier2Client(ctx, 'character_main_image_generator');
  if (!required.ok) return { error: required.error };

  const promptOverride =
    typeof input.prompt === 'string' && input.prompt.trim().length > 0 ? input.prompt.trim() : null;

  try {
    const result = await generateCharacterMainImage({
      characterName,
      // Pass the expander's prompt verbatim if available. buildCharacterMainPrompt
      // also tacks on the style hint — so when Planner expanded, we override the
      // style with a minimal one so the full expanded text is the only signal.
      visualDescription: promptOverride ?? visualDescription,
      ...(promptOverride ? { styleHint: 'keep exactly as written' } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    ctx.logger.info('character_main_image_generator.success', {
      characterUri,
      slug,
      byteLength: result.byteLength,
      localPath: result.entry.realAssetLocalPath,
    });
    return {
      status: 'ready',
      uri: characterUri,
      slug,
      remoteUrl: result.remoteUrl,
      localPath: result.entry.realAssetLocalPath ?? null,
      byteLength: result.byteLength,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.error('character_main_image_generator.error', {
      characterUri,
      slug,
      error: msg,
    });
    return { status: 'error', uri: characterUri, slug, error: msg };
  }
};
