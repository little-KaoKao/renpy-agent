import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
} from '../../agents/workspace-io.js';
import type { StoryboarderOutput } from '../../pipeline/types.js';
import { requireTier2Client } from '../common/tier2-helpers.js';
import { generateSfx } from './generate-sfx.js';
import type { SfxCue } from '../../assets/logical-key.js';

const ALLOWED_CUES: ReadonlySet<SfxCue> = new Set(['enter', 'action', 'exit', 'ambient']);

interface SfxDoc {
  readonly uri: string;
  readonly shotNumber: number;
  readonly cue: SfxCue;
  readonly description: string;
  readonly audioUri: string;
  readonly status: 'ready';
  readonly updatedAt: string;
}

const generate_sfx: ToolExecutor = async (args, ctx) => {
  const shotNumber = typeof args.shotNumber === 'number' ? args.shotNumber : null;
  const cueRaw = typeof args.cue === 'string' ? args.cue : null;
  const description = typeof args.description === 'string' ? args.description : null;
  const voiceHint = typeof args.voiceHint === 'string' ? args.voiceHint : undefined;

  if (shotNumber === null) return { error: 'generate_sfx: shotNumber required' };
  if (!cueRaw) return { error: 'generate_sfx: cue required' };
  if (!ALLOWED_CUES.has(cueRaw as SfxCue)) {
    return { error: `generate_sfx: cue must be one of enter|action|exit|ambient (got "${cueRaw}")` };
  }
  const cue = cueRaw as SfxCue;
  if (!description) return { error: 'generate_sfx: description required' };

  const required = requireTier2Client(ctx, 'generate_sfx');
  if (!required.ok) return { error: required.error };

  // Validate shot exists so Planner gets a clear error instead of "shot ready but wrong SFX".
  const storyboard = await readWorkspaceDoc<StoryboarderOutput>(
    'workspace://storyboard',
    ctx.gameDir,
  );
  if (!storyboard) return { error: 'generate_sfx: workspace://storyboard not found' };
  const shot = storyboard.shots.find((s) => s.shotNumber === shotNumber);
  if (!shot) return { error: `generate_sfx: shot ${shotNumber} not found in storyboard` };

  const targetUri = `workspace://sfx/shot_${shotNumber}_${cue}`;

  try {
    const result = await generateSfx({
      shotNumber,
      cue,
      description,
      ...(voiceHint !== undefined ? { voiceHint } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const doc: SfxDoc = {
      uri: targetUri,
      shotNumber,
      cue,
      description,
      audioUri: result.entry.realAssetLocalPath ?? result.remoteUrl,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
    ctx.logger.info('sfx_designer.generate_sfx', { uri: targetUri, audioUri: doc.audioUri });
    return { uri: targetUri, audioUri: doc.audioUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('sfx_designer.generate_sfx', { error: msg });
    return { error: msg };
  }
};

export const sfxDesignerTools: PocToolSet = {
  schemas: [
    {
      name: 'generate_sfx',
      description:
        'Generate a sound effect cue for a shot. Persists workspace://sfx/shot_<N>_<cue> and registers the asset. ' +
        'cue must be one of enter|action|exit|ambient.',
      inputSchema: {
        type: 'object',
        properties: {
          shotNumber: { type: 'number' },
          cue: { type: 'string', enum: ['enter', 'action', 'exit', 'ambient'] },
          description: {
            type: 'string',
            description: 'Free-form description of the sound (e.g. "sliding classroom door opens, wooden").',
          },
          voiceHint: {
            type: 'string',
            description: 'Optional pronunciation / voice-field hint; defaults to ambient-sound placeholder.',
          },
        },
        required: ['shotNumber', 'cue', 'description'],
      },
    },
  ],
  executors: { generate_sfx },
};
