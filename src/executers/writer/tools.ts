import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import { readWorkspaceDoc, writeWorkspaceDoc } from '../../agents/workspace-io.js';
import { runWriter } from '../../pipeline/writer.js';
import type { PlannerOutput } from '../../pipeline/types.js';

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

const draft_script: ToolExecutor = async (args, ctx) => {
  if (!ctx.llm) return { error: 'draft_script: ctx.llm not injected' };

  const chapterUri = typeof args.chapterUri === 'string' ? args.chapterUri : '';
  const characterUris = Array.isArray(args.characterUris) ? args.characterUris : [];
  const sceneUris = Array.isArray(args.sceneUris) ? args.sceneUris : [];

  if (!chapterUri) return { error: 'draft_script: chapterUri required' };

  const chapter = await readWorkspaceDoc<ChapterDoc>(chapterUri, ctx.gameDir);
  if (!chapter) return { error: `draft_script: chapter not found at ${chapterUri}` };

  const project = await readWorkspaceDoc<ProjectDoc>('workspace://project', ctx.gameDir);
  if (!project) return { error: 'draft_script: project not found at workspace://project' };

  type MutableCharacter = { name: string; description: string; visualDescription: string };
  const characters: MutableCharacter[] = [];
  for (const uri of characterUris as string[]) {
    const doc = await readWorkspaceDoc<CharacterDoc>(uri, ctx.gameDir);
    if (!doc) return { error: `draft_script: character not found at ${uri}` };
    characters.push({
      name: doc.name,
      description: doc.description,
      visualDescription: doc.visualDescription,
    });
  }
  type MutableScene = { name: string; description: string };
  const scenes: MutableScene[] = [];
  for (const uri of sceneUris as string[]) {
    const doc = await readWorkspaceDoc<SceneDoc>(uri, ctx.gameDir);
    if (!doc) return { error: `draft_script: scene not found at ${uri}` };
    scenes.push({ name: doc.name, description: doc.description });
  }

  const plannerOutput: PlannerOutput = {
    projectTitle: project.title,
    genre: project.genre,
    tone: project.tone,
    characters,
    scenes,
    chapterOutline: chapter.outline,
  };

  const writerOutput = await runWriter({ planner: plannerOutput, llm: ctx.llm });
  await writeWorkspaceDoc('workspace://script', ctx.gameDir, writerOutput);
  ctx.logger.info('writer.draft_script', { shotCount: writerOutput.scenes.length });
  return { uri: 'workspace://script', sceneCount: writerOutput.scenes.length };
};

export const writerTools: PocToolSet = {
  schemas: [
    {
      name: 'draft_script',
      description:
        'Draft the chapter script by assembling the per-URI workspace docs into a PlannerOutput ' +
        'and invoking the Writer LLM. Persists to workspace://script.',
      inputSchema: {
        type: 'object',
        properties: {
          chapterUri: { type: 'string' },
          characterUris: { type: 'array', items: { type: 'string' } },
          sceneUris: { type: 'array', items: { type: 'string' } },
        },
        required: ['chapterUri', 'characterUris', 'sceneUris'],
      },
    },
  ],
  executors: { draft_script },
};
