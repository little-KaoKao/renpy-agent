import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type {
  LlmClient,
  LlmToolChatResponse,
  LlmToolUseBlock,
} from '../../llm/types.js';
import { uiDesignerTools } from './tools.js';

function stubLlm(): LlmClient {
  const toolUse: LlmToolUseBlock = {
    type: 'tool_use',
    id: 'tu1',
    name: 'emit_ui_design',
    input: {
      headerText: 'Sakura Moonlight',
      layout: 'vbox',
      buttons: [
        { label: 'Start', action: 'Start()' },
        { label: 'Load', action: 'ShowMenu("load")' },
      ],
    },
  };
  const response: LlmToolChatResponse = {
    content: [toolUse],
    stopReason: 'tool_use',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  return {
    chat: async () => {
      throw new Error('unused in ui-designer tests');
    },
    chatWithTools: async () => response,
  };
}

async function makeCtx(opts: { withProject?: boolean; withLlm?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'v5-ui-'));
  const gameDir = resolve(root, 'game');
  const wsDir = resolve(root, 'workspace');
  await mkdir(gameDir, { recursive: true });
  await mkdir(wsDir, { recursive: true });
  if (opts.withProject) {
    await writeFile(
      resolve(wsDir, 'project.json'),
      JSON.stringify({ title: 'Sakura Moonlight', genre: 'romance', tone: 'warm' }, null, 2),
      'utf8',
    );
  }
  const base: CommonToolContext = {
    storyName: 's',
    gameDir,
    workspaceDir: wsDir,
    memoryDir: resolve(root, 'memory'),
    taskAgents: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return opts.withLlm ? { ...base, llm: stubLlm() } : base;
}

describe('uiDesigner.generate_ui_patch', () => {
  it('errors on unknown screen', async () => {
    const ctx = await makeCtx({ withLlm: true, withProject: true });
    const res = await uiDesignerTools.executors.generate_ui_patch!(
      { screen: 'cool_menu' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/screen must be one of/) });
  });

  it('errors when llm missing', async () => {
    const ctx = await makeCtx({ withProject: true });
    const res = await uiDesignerTools.executors.generate_ui_patch!(
      { screen: 'main_menu' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/ctx\.llm/) });
  });

  it('errors when project missing', async () => {
    const ctx = await makeCtx({ withLlm: true });
    const res = await uiDesignerTools.executors.generate_ui_patch!(
      { screen: 'main_menu' },
      ctx,
    );
    expect(res).toMatchObject({ error: expect.stringMatching(/project missing title/) });
  });

  it('persists UiDesign doc with compiled rpy patch', async () => {
    const ctx = await makeCtx({ withLlm: true, withProject: true });
    const res = (await uiDesignerTools.executors.generate_ui_patch!(
      { screen: 'main_menu', moodTag: 'romantic pastel' },
      ctx,
    )) as { uri: string; screen: string; status: string };
    expect(res.status).toBe('ready');
    expect(res.uri).toBe('workspace://uiDesign/main_menu');
    const doc = JSON.parse(
      await readFile(
        resolve(ctx.gameDir, '..', 'workspace', 'ui_designs', 'main_menu.json'),
        'utf8',
      ),
    );
    expect(doc).toMatchObject({
      screen: 'main_menu',
      moodTag: 'romantic pastel',
      status: 'ready',
    });
    expect(doc.rpyScreenPatch).toContain('screen main_menu');
    expect(doc.rpyScreenPatch).toContain('Sakura Moonlight');
  });
});
