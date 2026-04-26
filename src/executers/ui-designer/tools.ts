import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
} from '../../agents/workspace-io.js';
import { generateUiPatch } from './generate-ui-patch.js';
import type { UiDesign } from '../../schema/galgame-workspace.js';

const ALLOWED_SCREENS: ReadonlyArray<UiDesign['screen']> = [
  'main_menu',
  'save_load',
  'dialogue',
  'route_branch',
  'cg_gallery',
  'bgm_gallery',
  'preferences',
];

interface ProjectDoc {
  readonly title?: string;
}

interface UiDesignDoc {
  readonly uri: string;
  readonly screen: UiDesign['screen'];
  readonly moodTag: string;
  readonly rpyScreenPatch: string;
  readonly status: 'ready';
  readonly updatedAt: string;
}

const generate_ui_patch: ToolExecutor = async (args, ctx) => {
  const screenRaw = typeof args.screen === 'string' ? args.screen : null;
  const moodTag = typeof args.moodTag === 'string' ? args.moodTag : '';
  if (!screenRaw || !ALLOWED_SCREENS.includes(screenRaw as UiDesign['screen'])) {
    return {
      error: `generate_ui_patch: screen must be one of ${ALLOWED_SCREENS.join('|')}`,
    };
  }
  const screen = screenRaw as UiDesign['screen'];
  if (!ctx.llm) return { error: 'generate_ui_patch: ctx.llm not injected' };

  const project = await readWorkspaceDoc<ProjectDoc>('workspace://project', ctx.gameDir);
  if (!project?.title) return { error: 'generate_ui_patch: workspace://project missing title' };

  const targetUri = `workspace://uiDesign/${screen}`;

  try {
    const result = await generateUiPatch({
      screen,
      moodTag: moodTag || 'clean modern galgame',
      projectTitle: project.title,
      llmClient: ctx.llm,
    });
    const doc: UiDesignDoc = {
      uri: targetUri,
      screen,
      moodTag: moodTag || 'clean modern galgame',
      rpyScreenPatch: result.rpyScreenPatch,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
    ctx.logger.info('ui_designer.generate_ui_patch', { uri: targetUri, screen });
    return { uri: targetUri, screen, status: 'ready' };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.logger.error('ui_designer.generate_ui_patch', { error: msg });
    return { error: msg };
  }
};

export const uiDesignerTools: PocToolSet = {
  schemas: [
    {
      name: 'generate_ui_patch',
      description:
        "Generate a Ren'Py screens.rpy patch for one screen. Uses the project title, invokes the UI Designer LLM " +
        'via tool_use, and persists workspace://uiDesign/<screen> with the compiled rpyScreenPatch.',
      inputSchema: {
        type: 'object',
        properties: {
          screen: {
            type: 'string',
            enum: [...ALLOWED_SCREENS],
            description: "The Ren'Py screen to override.",
          },
          moodTag: {
            type: 'string',
            description: 'Short mood hint (e.g. "romantic pastel", "noir serious").',
          },
        },
        required: ['screen'],
      },
    },
  ],
  executors: { generate_ui_patch },
};
