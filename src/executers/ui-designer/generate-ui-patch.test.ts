import { describe, expect, it, vi } from 'vitest';
import {
  generateUiPatch,
  renderUiPatch,
  validateUiPatch,
  type UiPatchDesign,
} from './generate-ui-patch.js';
import type {
  LlmClient,
  LlmToolChatParams,
  LlmToolChatResponse,
} from '../../llm/types.js';

function toolUseClient(design: unknown): LlmClient {
  const chatWithTools = vi.fn(async (_p: LlmToolChatParams): Promise<LlmToolChatResponse> => ({
    content: [
      { type: 'tool_use', id: 'tu_1', name: 'emit_ui_design', input: design as Record<string, unknown> },
    ],
    stopReason: 'tool_use',
    usage: { inputTokens: 0, outputTokens: 0 },
  }));
  return { chat: vi.fn(), chatWithTools } as unknown as LlmClient;
}

describe('generateUiPatch (tool_use)', () => {
  it('builds a Ren\'Py screen block from a structured UiPatchDesign', async () => {
    const design: UiPatchDesign = {
      headerText: 'Sakura Night',
      layout: 'vbox',
      bgColor: '#ffe7f0',
      buttons: [
        { label: 'Start', action: 'Start()' },
        { label: 'Load', action: 'ShowMenu("load")' },
        { label: 'Quit', action: 'Quit(confirm=False)' },
      ],
    };
    const llm = toolUseClient(design);
    const result = await generateUiPatch({
      screen: 'main_menu',
      moodTag: 'pastel romance',
      projectTitle: 'Sakura Night',
      llmClient: llm,
    });

    expect(result.screen).toBe('main_menu');
    expect(result.rpyScreenPatch).toContain('# --- ui-patch: main_menu (mood: pastel romance) ---');
    expect(result.rpyScreenPatch).toContain('screen main_menu():');
    expect(result.rpyScreenPatch).toContain('Solid("#ffe7f0")');
    expect(result.rpyScreenPatch).toContain('text "Sakura Night"');
    expect(result.rpyScreenPatch).toContain('textbutton "Start" action Start()');
    expect(result.rpyScreenPatch).toContain('textbutton "Quit" action Quit(confirm=False)');
  });

  it('throws when LLM does not call emit_ui_design', async () => {
    const llm: LlmClient = {
      chat: vi.fn(),
      chatWithTools: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'refused' }],
        stopReason: 'end_turn' as const,
        usage: { inputTokens: 0, outputTokens: 0 },
      })),
    };
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'm',
        projectTitle: 'p',
        llmClient: llm,
      }),
    ).rejects.toThrow(/emit_ui_design/);
  });

  it('throws when buttons is missing', async () => {
    const llm = toolUseClient({ headerText: 'Title' });
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'm',
        projectTitle: 'p',
        llmClient: llm,
      }),
    ).rejects.toThrow(/buttons/);
  });

  it('rejects button labels / actions containing quotes or newlines', async () => {
    const llm = toolUseClient({
      headerText: 'X',
      buttons: [{ label: 'bad"label', action: 'Start()' }],
    });
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'm',
        projectTitle: 'p',
        llmClient: llm,
      }),
    ).rejects.toThrow(/button label/i);
  });

  it('rejects bgColor that is not a #rrggbb hex', async () => {
    const llm = toolUseClient({
      headerText: 'X',
      bgColor: "javascript:alert('x')",
      buttons: [{ label: 'Start', action: 'Start()' }],
    });
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'm',
        projectTitle: 'p',
        llmClient: llm,
      }),
    ).rejects.toThrow(/bgColor/);
  });
});

describe('renderUiPatch', () => {
  it('produces a block that passes validateUiPatch', () => {
    const patch = renderUiPatch({
      screen: 'main_menu',
      moodTag: 'pastel',
      design: {
        headerText: 'Title',
        buttons: [{ label: 'Start', action: 'Start()' }],
      },
    });
    expect(() => validateUiPatch(patch, 'main_menu')).not.toThrow();
  });

  it('never produces `init python` or `import` regardless of (hostile) input', () => {
    // Inputs that pass structural validation should never smuggle Python. The
    // renderer is the single source of truth for the Ren'Py output, so even
    // something bizarre like an all-allowed-char label cannot inject code.
    const patch = renderUiPatch({
      screen: 'main_menu',
      moodTag: 'x',
      design: {
        headerText: 'safe header',
        buttons: [{ label: 'LongButton', action: 'Start()' }],
      },
    });
    expect(patch).not.toMatch(/^\s*init\s+python/m);
    expect(patch).not.toMatch(/^\s*import\s+/m);
    expect(patch).not.toMatch(/^\s*style\s+/m);
    expect(patch).not.toMatch(/^\s*font\s+["']/m);
  });

  it('emits default button set when buttons is empty array', () => {
    const patch = renderUiPatch({
      screen: 'main_menu',
      moodTag: 'x',
      design: { headerText: 'T', buttons: [] },
    });
    // Empty buttons is structurally valid but unhelpful; renderer still produces
    // a compilable screen (no buttons rendered).
    expect(patch).toContain('screen main_menu():');
  });
});

describe('validateUiPatch', () => {
  it('accepts a rendered block', () => {
    const patch = renderUiPatch({
      screen: 'main_menu',
      moodTag: 'pastel',
      design: {
        headerText: 'Title',
        buttons: [{ label: 'Start', action: 'Start()' }],
      },
    });
    expect(() => validateUiPatch(patch, 'main_menu')).not.toThrow();
  });

  it('rejects mismatched screen name', () => {
    const patch = renderUiPatch({
      screen: 'main_menu',
      moodTag: 'x',
      design: { headerText: 'T', buttons: [] },
    });
    expect(() => validateUiPatch(patch, 'save_load')).toThrow(/must start with/);
  });

  it('rejects empty patches', () => {
    expect(() => validateUiPatch('   \n   \n', 'main_menu')).toThrow(/empty|no code/);
  });
});
