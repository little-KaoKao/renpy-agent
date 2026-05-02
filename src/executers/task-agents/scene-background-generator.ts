// scene_background_generator — v0.7 concrete task agent.
//
// Input shape:
//   { sceneUri: string, slug?: string, prompt?: string, timeOfDay?: string,
//     DRY_RUN?: boolean }
// - `sceneUri` required — we read the Scene doc to get name + description.
// - `prompt` optional override for the freeform description; useful when a
//   Planner-side expander has already polished wording.
// - `timeOfDay` optional; threaded through buildSceneBackgroundPrompt for
//   the lighting hint.
//
// Output: { status: 'ready' | 'error' | 'dry_run', localPath?: string,
//   remoteUrl?: string, byteLength?: number, error?: string, uri, slug }.

import type { TaskAgentFn } from '../../agents/common-tools.js';
import { readWorkspaceDoc } from '../../agents/workspace-io.js';
import { generateSceneBackground } from '../scene-designer/generate-background.js';
import { requireTier2Client, slugForFilename } from '../common/tier2-helpers.js';
import { isDryRun } from './shared.js';

interface SceneDocMin {
  readonly name?: string;
  readonly description?: string;
}

export const sceneBackgroundGenerator: TaskAgentFn = async (input, ctx) => {
  const sceneUri = typeof input.sceneUri === 'string' ? input.sceneUri : null;
  if (!sceneUri) {
    return { error: 'scene_background_generator: sceneUri is required' };
  }

  const doc = await readWorkspaceDoc<SceneDocMin>(sceneUri, ctx.gameDir);
  if (!doc) {
    return {
      error: `scene_background_generator: scene document not found at ${sceneUri}`,
    };
  }
  const sceneName = typeof doc.name === 'string' ? doc.name : null;
  const description = typeof doc.description === 'string' ? doc.description : '';
  if (!sceneName) {
    return { error: `scene_background_generator: scene at ${sceneUri} has no name` };
  }

  const slugOverride = typeof input.slug === 'string' && input.slug.length > 0 ? input.slug : null;
  const slug = slugOverride ?? slugForFilename(sceneName);

  if (isDryRun(input)) {
    const mockRemote = `https://dry-run.invalid/scene/${slug}.png`;
    const mockLocal = `images/bg/${slug}.png`;
    ctx.logger.info('scene_background_generator.dry_run', { sceneUri, slug });
    return {
      status: 'dry_run',
      uri: sceneUri,
      slug,
      remoteUrl: mockRemote,
      localPath: mockLocal,
      dryRun: true,
    };
  }

  const required = requireTier2Client(ctx, 'scene_background_generator');
  if (!required.ok) return { error: required.error };

  const promptOverride =
    typeof input.prompt === 'string' && input.prompt.trim().length > 0 ? input.prompt.trim() : null;
  const timeOfDay = typeof input.timeOfDay === 'string' ? input.timeOfDay : undefined;

  try {
    const result = await generateSceneBackground({
      sceneName,
      description: promptOverride ?? description,
      ...(timeOfDay !== undefined ? { timeOfDay } : {}),
      ...(promptOverride ? { styleHint: 'keep exactly as written' } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    ctx.logger.info('scene_background_generator.success', {
      sceneUri,
      slug,
      byteLength: result.byteLength,
      localPath: result.entry.realAssetLocalPath,
    });
    return {
      status: 'ready',
      uri: sceneUri,
      slug,
      remoteUrl: result.remoteUrl,
      localPath: result.entry.realAssetLocalPath ?? null,
      byteLength: result.byteLength,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.error('scene_background_generator.error', {
      sceneUri,
      slug,
      error: msg,
    });
    return { status: 'error', uri: sceneUri, slug, error: msg };
  }
};
