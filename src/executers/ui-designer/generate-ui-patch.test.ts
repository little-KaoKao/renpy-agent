import { describe, expect, it, vi } from 'vitest';
import { generateUiPatch, validateUiPatch } from './generate-ui-patch.js';
import type {
  LlmChatParams,
  LlmClient,
  LlmResponse,
} from '../../llm/types.js';

function mockLlm(content: string): LlmClient {
  const chat = vi.fn(async (_params: LlmChatParams): Promise<LlmResponse> => ({
    content,
    usage: { inputTokens: 0, outputTokens: 0 },
  }));
  return { chat } as unknown as LlmClient;
}

const GOOD_PATCH = `# --- ui-patch: main_menu (mood: pastel romance) ---
screen main_menu():
    tag menu
    add Solid("#ffe7f0")
    vbox:
        xalign 0.5 yalign 0.4
        text "Sakura Night" size 60 color "#d64a7a"
        textbutton "Start" action Start()
        textbutton "Load" action ShowMenu("load")
        textbutton "Quit" action Quit(confirm=False)
`;

describe('generateUiPatch', () => {
  it('returns patch string and screen name on well-formed LLM output', async () => {
    const llm = mockLlm(GOOD_PATCH);
    const result = await generateUiPatch({
      screen: 'main_menu',
      moodTag: 'pastel romance',
      projectTitle: 'Sakura Night',
      llmClient: llm,
    });
    expect(result.screen).toBe('main_menu');
    expect(result.rpyScreenPatch).toContain('screen main_menu():');
    expect(result.rpyScreenPatch).toContain('# --- ui-patch: main_menu');
  });

  it('strips a ```renpy fence if the LLM wraps its answer', async () => {
    const llm = mockLlm('```renpy\n' + GOOD_PATCH + '\n```');
    const result = await generateUiPatch({
      screen: 'main_menu',
      moodTag: 'pastel romance',
      projectTitle: 'Sakura Night',
      llmClient: llm,
    });
    expect(result.rpyScreenPatch.startsWith('# --- ui-patch:')).toBe(true);
  });

  it('rejects patches that try to run init python', async () => {
    const bad = [
      '# --- ui-patch: main_menu (mood: pastel romance) ---',
      'screen main_menu():',
      '    pass',
      '',
      'init python:',
      '    renpy.music.play("boom.ogg")',
    ].join('\n');
    const llm = mockLlm(bad);
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'pastel romance',
        projectTitle: 'Sakura Night',
        llmClient: llm,
      }),
    ).rejects.toThrow(/init python/);
  });

  it('rejects patches that do not start with `screen <name>`', async () => {
    const bad = 'label start:\n    "not a screen"\n';
    const llm = mockLlm(bad);
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'whatever',
        projectTitle: 'X',
        llmClient: llm,
      }),
    ).rejects.toThrow(/must start with/);
  });

  it('rejects empty patches', async () => {
    const llm = mockLlm('   \n   \n');
    await expect(
      generateUiPatch({
        screen: 'main_menu',
        moodTag: 'whatever',
        projectTitle: 'X',
        llmClient: llm,
      }),
    ).rejects.toThrow(/empty/);
  });
});

describe('validateUiPatch', () => {
  it('allows comment headers before the screen line', () => {
    expect(() => validateUiPatch(GOOD_PATCH, 'main_menu')).not.toThrow();
  });

  it('rejects mismatched screen name', () => {
    expect(() => validateUiPatch(GOOD_PATCH, 'save_load')).toThrow(/must start with/);
  });

  it('rejects import statements', () => {
    const bad =
      '# --- ui-patch: main_menu (mood: x) ---\nscreen main_menu():\n    pass\nimport os\n';
    expect(() => validateUiPatch(bad, 'main_menu')).toThrow(/import/);
  });

  it('rejects font property overrides (project ships only one font)', () => {
    const bad = [
      '# --- ui-patch: main_menu (mood: pastel) ---',
      'screen main_menu():',
      '    tag menu',
      '    text "Title":',
      '        size 54',
      '        font "gui/font/NotoSansCJK-Regular.ttc"',
    ].join('\n');
    expect(() => validateUiPatch(bad, 'main_menu')).toThrow(/font/);
  });

  it('accepts text elements without a font property (inherit default)', () => {
    const ok = [
      '# --- ui-patch: main_menu (mood: pastel) ---',
      'screen main_menu():',
      '    tag menu',
      '    text "Title":',
      '        size 54',
      '        color "#c47fa0"',
    ].join('\n');
    expect(() => validateUiPatch(ok, 'main_menu')).not.toThrow();
  });
});
