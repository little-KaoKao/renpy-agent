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

  // Wrap runWriter: its internal retryOnStageValidationError already attempts
  // twice. If it still fails, bubbling the raw Error lets the Planner re-handoff
  // writer indefinitely — which is exactly the $5 burn seen in M6 smoke
  // (2026-05-02): 18 handoffs × 2 retries = 36 LLM calls, all producing
  // empty emit_writer_output inputs. Catch, return structured non-retriable
  // error so the Planner either tries a different tactic or gracefully finishes.
  try {
    const writerOutput = await runWriter({ planner: plannerOutput, llm: ctx.llm });
    await writeWorkspaceDoc('workspace://script', ctx.gameDir, writerOutput);
    ctx.logger.info('writer.draft_script', { shotCount: writerOutput.scenes.length });
    return { uri: 'workspace://script', sceneCount: writerOutput.scenes.length, saved: true };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('writer.draft_script', { error: msg });
    return {
      error: `draft_script failed after internal retry: ${msg}`,
      retry: false,
      guidance:
        'Writer LLM could not produce a valid script after 2 attempts. Do not re-handoff the writer with the same inputs. Consider: (a) shrinking the planner context (fewer characters / scenes), (b) finishing the task and letting a human review, or (c) if this persists, finish Stage A with whatever is in workspace://script if any older version exists.',
    };
  }
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
