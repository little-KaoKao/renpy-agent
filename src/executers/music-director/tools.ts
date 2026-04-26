import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
} from '../../agents/workspace-io.js';
import { requireTier2Client, slugForFilename } from '../common/tier2-helpers.js';
import { generateBgmTrack } from './generate-bgm-track.js';

interface SceneDoc {
  readonly name?: string;
  readonly description?: string;
}

interface BgmTrackDoc {
  readonly uri: string;
  readonly trackName: string;
  readonly moodTag: string;
  readonly styleDescription: string;
  readonly sceneUri?: string;
  readonly audioUri: string;
  readonly status: 'ready' | 'error';
  readonly errorMessage?: string;
  readonly updatedAt: string;
}

const generate_bgm_track: ToolExecutor = async (args, ctx) => {
  const trackName = typeof args.trackName === 'string' ? args.trackName : null;
  const moodTag = typeof args.moodTag === 'string' ? args.moodTag : '';
  const styleDescription = typeof args.styleDescription === 'string' ? args.styleDescription : null;
  const sceneUri = typeof args.sceneUri === 'string' ? args.sceneUri : null;
  const version = typeof args.version === 'string' ? args.version : undefined;

  if (!trackName) return { error: 'generate_bgm_track: trackName required' };
  if (!styleDescription) return { error: 'generate_bgm_track: styleDescription required' };

  const required = requireTier2Client(ctx, 'generate_bgm_track');
  if (!required.ok) return { error: required.error };

  // Optional scene dependency — read for context, but don't fail if missing.
  let sceneContext = '';
  if (sceneUri) {
    const scene = await readWorkspaceDoc<SceneDoc>(sceneUri, ctx.gameDir);
    if (scene?.description) sceneContext = ` Scene: ${scene.description}.`;
  }

  const trackSlug = slugForFilename(trackName);
  const targetUri = `workspace://bgmTrack/${trackSlug}`;
  const combinedStyle = `${styleDescription}${sceneContext}`.trim();

  try {
    const result = await generateBgmTrack({
      trackName,
      styleDescription: combinedStyle,
      ...(version !== undefined ? { version } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const doc: BgmTrackDoc = {
      uri: targetUri,
      trackName,
      moodTag,
      styleDescription: combinedStyle,
      ...(sceneUri ? { sceneUri } : {}),
      audioUri: result.entry.realAssetLocalPath ?? result.remoteUrl,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
    ctx.logger.info('music_director.generate_bgm_track', {
      uri: targetUri,
      audioUri: doc.audioUri,
    });
    return { uri: targetUri, audioUri: doc.audioUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('music_director.generate_bgm_track', { error: msg });
    return { error: msg };
  }
};

export const musicDirectorTools: PocToolSet = {
  schemas: [
    {
      name: 'generate_bgm_track',
      description:
        'Generate a BGM track (RunningHub SunoV5) and persist it as workspace://bgmTrack/<slug>. ' +
        'Style description should describe mood / instrumentation / tempo. Optional sceneUri pulls scene context into the prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          trackName: { type: 'string', description: 'Human-readable track name; produces the slug.' },
          moodTag: { type: 'string', description: 'Short mood label, e.g. "calm", "tense".' },
          styleDescription: {
            type: 'string',
            description: 'Free-form style prompt: genre, instrumentation, tempo, language.',
          },
          sceneUri: { type: 'string', description: 'Optional workspace://scene/<slug> to enrich the prompt.' },
          version: {
            type: 'string',
            description: 'Suno version override, defaults to v4.5. Allowed: v3.0, v3.5, v4, v4.5, v4.5+, v5.',
          },
        },
        required: ['trackName', 'styleDescription'],
      },
    },
  ],
  executors: { generate_bgm_track },
};
