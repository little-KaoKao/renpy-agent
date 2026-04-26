import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../../agents/workspace-io.js';
import { runStoryboarder } from '../../pipeline/storyboarder.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from '../../pipeline/types.js';
import { requireTier2Client } from '../common/tier2-helpers.js';
import { findByLogicalKey, loadRegistry } from '../../assets/registry.js';
import { logicalKeyForScene, logicalKeyForCharacter } from '../../assets/logical-key.js';
import { generateCutsceneVideo, type CutsceneKind } from './generate-cutscene.js';

interface ProjectDoc {
  readonly title: string;
  readonly genre: string;
  readonly tone: string;
}
interface ChapterDoc {
  readonly outline: string;
}
interface CharacterDoc {
  readonly name: string;
  readonly description: string;
  readonly visualDescription: string;
}
interface SceneDoc {
  readonly name: string;
  readonly description: string;
}

async function assemblePlannerOutput(gameDir: string): Promise<PlannerOutput | string> {
  const project = await readWorkspaceDoc<ProjectDoc>('workspace://project', gameDir);
  if (!project) return 'project not found';
  const chapter = await readWorkspaceDoc<ChapterDoc>('workspace://chapter', gameDir);
  if (!chapter) return 'chapter not found';

  const { listWorkspaceCollection } = await import('../../agents/workspace-io.js');
  const charEntries = await listWorkspaceCollection('character', gameDir);
  const sceneEntries = await listWorkspaceCollection('scene', gameDir);

  const characters: Array<PlannerOutput['characters'][number]> = [];
  for (const e of charEntries) {
    const doc = await readWorkspaceDoc<CharacterDoc>(e.uri, gameDir);
    if (doc) {
      characters.push({
        name: doc.name,
        description: doc.description,
        visualDescription: doc.visualDescription,
      });
    }
  }
  const scenes: Array<PlannerOutput['scenes'][number]> = [];
  for (const e of sceneEntries) {
    const doc = await readWorkspaceDoc<SceneDoc>(e.uri, gameDir);
    if (doc) scenes.push({ name: doc.name, description: doc.description });
  }

  return {
    projectTitle: project.title,
    genre: project.genre,
    tone: project.tone,
    characters,
    scenes,
    chapterOutline: chapter.outline,
  };
}

const condense_to_shots: ToolExecutor = async (args, ctx) => {
  if (!ctx.llm) return { error: 'condense_to_shots: ctx.llm not injected' };
  const scriptUri = typeof args.scriptUri === 'string' ? args.scriptUri : 'workspace://script';

  const writer = await readWorkspaceDoc<WriterOutput>(scriptUri, ctx.gameDir);
  if (!writer) return { error: `condense_to_shots: script not found at ${scriptUri}` };

  const planner = await assemblePlannerOutput(ctx.gameDir);
  if (typeof planner === 'string') return { error: `condense_to_shots: ${planner}` };

  const storyboard = await runStoryboarder({ planner, writer, llm: ctx.llm });
  await writeWorkspaceDoc('workspace://storyboard', ctx.gameDir, storyboard);
  ctx.logger.info('storyboarder.condense_to_shots', { shots: storyboard.shots.length });
  return { uri: 'workspace://storyboard', shotCount: storyboard.shots.length };
};

interface CutsceneDoc {
  readonly uri: string;
  readonly shotNumber: number;
  readonly kind: CutsceneKind;
  readonly motionPrompt: string;
  readonly referenceImageUri?: string;
  readonly videoUri: string;
  readonly status: 'ready';
  readonly updatedAt: string;
}

const ALLOWED_KINDS: ReadonlySet<CutsceneKind> = new Set(['transition', 'reference']);

const generate_cutscene: ToolExecutor = async (args, ctx) => {
  const shotNumber = typeof args.shotNumber === 'number' ? args.shotNumber : null;
  const kindRaw = typeof args.kind === 'string' ? args.kind : null;
  const motionPrompt = typeof args.motionPrompt === 'string' ? args.motionPrompt : null;
  const styleHint = typeof args.styleHint === 'string' ? args.styleHint : undefined;
  const explicitFirstFrame =
    typeof args.referenceImageUri === 'string' ? args.referenceImageUri : null;

  if (shotNumber === null) return { error: 'generate_cutscene: shotNumber required' };
  if (!kindRaw || !ALLOWED_KINDS.has(kindRaw as CutsceneKind)) {
    return { error: 'generate_cutscene: kind must be "transition" or "reference"' };
  }
  const kind = kindRaw as CutsceneKind;
  if (!motionPrompt) return { error: 'generate_cutscene: motionPrompt required' };

  const required = requireTier2Client(ctx, 'generate_cutscene');
  if (!required.ok) return { error: required.error };

  const storyboard = await readWorkspaceDoc<StoryboarderOutput>(
    'workspace://storyboard',
    ctx.gameDir,
  );
  if (!storyboard) return { error: 'generate_cutscene: workspace://storyboard not found' };
  const shot = storyboard.shots.find((s) => s.shotNumber === shotNumber);
  if (!shot) return { error: `generate_cutscene: shot ${shotNumber} not found in storyboard` };

  // First-frame resolution: explicit arg > scene background by shot.sceneName > character main image.
  let firstFrame = explicitFirstFrame ?? '';
  if (!firstFrame) {
    const registry = await loadRegistry(required.bundle.registryPath);
    if (shot.sceneName) {
      const hit = findByLogicalKey(registry, logicalKeyForScene(shot.sceneName));
      if (hit?.status === 'ready' && hit.remoteAssetUri) firstFrame = hit.remoteAssetUri;
    }
    if (!firstFrame && shot.characters[0]) {
      const hit = findByLogicalKey(registry, logicalKeyForCharacter(shot.characters[0]));
      if (hit?.status === 'ready' && hit.remoteAssetUri) firstFrame = hit.remoteAssetUri;
    }
  }
  if (kind === 'reference' && !firstFrame) {
    return {
      error:
        'generate_cutscene: kind="reference" requires a first-frame image URI — pass referenceImageUri explicitly or ensure the scene/character asset is ready in the registry.',
    };
  }

  const targetUri = `workspace://cutscene/shot_${shotNumber}`;

  try {
    const result = await generateCutsceneVideo({
      shotNumber,
      kind,
      motionPrompt,
      ...(styleHint !== undefined ? { styleHint } : {}),
      ...(firstFrame ? { referenceImageUri: firstFrame } : {}),
      gameDir: ctx.gameDir,
      registryPath: required.bundle.registryPath,
      client: required.bundle.client,
      ...(required.bundle.fetchFn !== undefined ? { fetchFn: required.bundle.fetchFn } : {}),
    });
    const doc: CutsceneDoc = {
      uri: targetUri,
      shotNumber,
      kind,
      motionPrompt,
      ...(firstFrame ? { referenceImageUri: firstFrame } : {}),
      videoUri: result.entry.realAssetLocalPath ?? result.remoteUrl,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
    ctx.logger.info('storyboarder.generate_cutscene', {
      uri: targetUri,
      videoUri: doc.videoUri,
    });
    return { uri: targetUri, videoUri: doc.videoUri, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('storyboarder.generate_cutscene', { error: msg });
    return { error: msg };
  }
};

export const storyboarderTools: PocToolSet = {
  schemas: [
    {
      name: 'condense_to_shots',
      description:
        'Condense the workspace://script into a Storyboard (<=8 shots). Persists to workspace://storyboard.',
      inputSchema: {
        type: 'object',
        properties: { scriptUri: { type: 'string' } },
      },
    },
    {
      name: 'generate_cutscene',
      description:
        'Generate a video cutscene (Seedance2.0 image-to-video) for a Shot. Persists workspace://cutscene/shot_<N>. ' +
        'kind="transition" pulls a scene first-frame; kind="reference" requires an explicit or registry-resolvable first frame.',
      inputSchema: {
        type: 'object',
        properties: {
          shotNumber: { type: 'number' },
          kind: { type: 'string', enum: ['transition', 'reference'] },
          motionPrompt: {
            type: 'string',
            description: 'What happens in the clip (camera motion, action).',
          },
          styleHint: { type: 'string', description: 'Optional style prompt extension.' },
          referenceImageUri: {
            type: 'string',
            description:
              'Optional first-frame URL. If omitted, resolved from scene/character assets via AssetRegistry.',
          },
        },
        required: ['shotNumber', 'kind', 'motionPrompt'],
      },
    },
  ],
  executors: {
    condense_to_shots,
    generate_cutscene,
  },
};

export { assemblePlannerOutput };
