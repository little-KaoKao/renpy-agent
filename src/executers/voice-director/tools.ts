import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
} from '../../agents/workspace-io.js';
import type { StoryboarderOutput } from '../../pipeline/types.js';
import { requireTier2Client } from '../common/tier2-helpers.js';
import { generateVoiceLine } from './generate-voice-line.js';

interface CharacterDoc {
  readonly name?: string;
  readonly voiceTag?: string;
}

interface VoiceLineDoc {
  readonly uri: string;
  readonly shotNumber: number;
  readonly lineIndex: number;
  readonly speaker: string;
  readonly text: string;
  readonly voiceTag: string;
  readonly audioUri: string;
  readonly status: 'ready';
  readonly updatedAt: string;
}

const generate_voice_line: ToolExecutor = async (args, ctx) => {
  const shotNumber = typeof args.shotNumber === 'number' ? args.shotNumber : null;
  const lineIndex = typeof args.lineIndex === 'number' ? args.lineIndex : null;
  const characterUri = typeof args.characterUri === 'string' ? args.characterUri : null;
  const voiceTagOverride = typeof args.voiceTag === 'string' ? args.voiceTag : null;
  const textOverride = typeof args.text === 'string' ? args.text : null;

  if (shotNumber === null) return { error: 'generate_voice_line: shotNumber required' };
  if (lineIndex === null) return { error: 'generate_voice_line: lineIndex required' };

  const required = requireTier2Client(ctx, 'generate_voice_line');
  if (!required.ok) return { error: required.error };

  // Resolve speaker + line text from the storyboard when the LLM didn't pass them
  // inline. The storyboard is the authoritative source for shot/line pairing.
  const storyboard = await readWorkspaceDoc<StoryboarderOutput>(
    'workspace://storyboard',
    ctx.gameDir,
  );
  if (!storyboard) return { error: 'generate_voice_line: workspace://storyboard not found' };
  const shot = storyboard.shots.find((s) => s.shotNumber === shotNumber);
  if (!shot) return { error: `generate_voice_line: shot ${shotNumber} not found in storyboard` };
  const line = shot.dialogueLines[lineIndex];
  if (!line) {
    return { error: `generate_voice_line: shot ${shotNumber} has no dialogue line ${lineIndex}` };
  }

  const text = textOverride ?? line.text;
  const speaker = line.speaker;

  // voiceTag resolution: explicit arg > character doc > fallback to speaker name.
  let voiceTag = voiceTagOverride ?? '';
  if (!voiceTag && characterUri) {
    const char = await readWorkspaceDoc<CharacterDoc>(characterUri, ctx.gameDir);
    if (char?.voiceTag) voiceTag = char.voiceTag;
  }
  if (!voiceTag) voiceTag = `${speaker}, clear voice`;

  const targetUri = `workspace://voiceLine/shot_${shotNumber}_line_${lineIndex}`;

  try {
    const result = await generateVoiceLine({
      shotNumber,
      lineIndex,
      text,
      voiceTag,
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const doc: VoiceLineDoc = {
      uri: targetUri,
      shotNumber,
      lineIndex,
      speaker,
      text,
      voiceTag,
      audioUri: result.entry.realAssetLocalPath ?? result.remoteUrl,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
    ctx.logger.info('voice_director.generate_voice_line', {
      uri: targetUri,
      audioUri: doc.audioUri,
    });
    return { uri: targetUri, audioUri: doc.audioUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('voice_director.generate_voice_line', { error: msg });
    return { error: msg };
  }
};

export const voiceDirectorTools: PocToolSet = {
  schemas: [
    {
      name: 'generate_voice_line',
      description:
        'Generate a voice line TTS for one shot dialogue line. Reads workspace://storyboard ' +
        'to pick (speaker, text) by (shotNumber, lineIndex), and optionally a Character doc for voiceTag. ' +
        'Persists workspace://voiceLine/shot_<N>_line_<i>.',
      inputSchema: {
        type: 'object',
        properties: {
          shotNumber: { type: 'number', description: 'The shot number from workspace://storyboard.' },
          lineIndex: {
            type: 'number',
            description: 'Zero-based index of the dialogue line within the shot.',
          },
          characterUri: {
            type: 'string',
            description: 'Optional workspace://character/<slug>; voiceTag comes from this doc if not overridden.',
          },
          voiceTag: {
            type: 'string',
            description: 'Optional override for voiceTag (timbre / language hint).',
          },
          text: {
            type: 'string',
            description: 'Optional override for the spoken text; defaults to the storyboard line text.',
          },
        },
        required: ['shotNumber', 'lineIndex'],
      },
    },
  ],
  executors: { generate_voice_line },
};
