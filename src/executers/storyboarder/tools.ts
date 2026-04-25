import { stubTool, type PocToolSet, type ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../../agents/workspace-io.js';
import { runStoryboarder } from '../../pipeline/storyboarder.js';
import type { PlannerOutput, WriterOutput } from '../../pipeline/types.js';

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

const cutsceneStub = stubTool(
  'generate_cutscene',
  'Generate a video cutscene for a Shot (Tier 2, v0.7).',
);

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
    cutsceneStub.schema,
  ],
  executors: {
    condense_to_shots,
    generate_cutscene: cutsceneStub.executor,
  },
};

export { assemblePlannerOutput };
