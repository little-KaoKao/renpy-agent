// UI 设计师:screens.rpy 补丁生成入口。
//
// 和其余 audio/image executer 不同,**不走 RunningHub**,不进 AssetRegistry —— 产物是
// 一段合法的 Ren'Py screen block 字符串,Coder 在 merge 阶段直接追加到 screens.rpy 末尾,
// 利用 Ren'Py "后定义 screen 覆盖先定义"的语义覆盖内置 screen。
//
// v0.5 范围内 UI 不生成图像资源,只产 screen 代码;按钮背景走默认 gui.rpy 风格。

import type { LlmClient } from '../../llm/types.js';
import type { UiDesign } from '../../schema/galgame-workspace.js';

export interface GenerateUiPatchParams {
  readonly screen: UiDesign['screen'];
  readonly moodTag: string;
  readonly projectTitle: string;
  readonly llmClient: LlmClient;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface GenerateUiPatchResult {
  readonly screen: UiDesign['screen'];
  readonly rpyScreenPatch: string;
}

const UI_PATCH_SYSTEM_PROMPT = `You are the UI Designer for a Ren'Py visual novel pipeline.
You produce one Ren'Py screen block that overrides a built-in screen.

Rules:
1. Output MUST start with \`screen <screen>():\` (no markdown fence, no prose).
2. First non-blank line must be a comment header: \`# --- ui-patch: <screen> (mood: <moodTag>) ---\`.
3. NO \`init python\` blocks, NO \`init\` blocks, NO \`import\` statements, NO \`style\` overrides,
   NO \`default\` statements.
4. Stick to visible screen elements: \`frame\`, \`vbox\`, \`hbox\`, \`textbutton\`, \`text\`, \`add\`,
   \`imagebutton\`. All colors via named colors or hex like \`"#rrggbb"\`.
5. Do NOT reference external image files (image backgrounds) — Ren'Py's default gui.rpy assets are fine.
6. Do NOT set a \`font "..."\` property on any text element. The project ships exactly one
   font (SourceHanSansLite.ttf, wired through gui.text_font) and referencing any other font
   file will crash at runtime. Just omit the font property — text elements inherit the default.
7. Keep it self-contained and under ~40 lines.`;

function buildUserPrompt(
  screen: UiDesign['screen'],
  moodTag: string,
  projectTitle: string,
): string {
  return [
    `Project title: ${projectTitle}`,
    `Screen to override: ${screen}`,
    `Visual mood: ${moodTag}`,
    '',
    `Produce the Ren'Py screen block. Remember: start with \`screen ${screen}():\`` +
      ` on the first code line, preceded only by the ui-patch comment header.`,
  ].join('\n');
}

export async function generateUiPatch(
  params: GenerateUiPatchParams,
): Promise<GenerateUiPatchResult> {
  const res = await params.llmClient.chat({
    messages: [
      { role: 'system', content: UI_PATCH_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserPrompt(params.screen, params.moodTag, params.projectTitle),
      },
    ],
    temperature: params.temperature ?? 0.6,
    maxTokens: params.maxTokens ?? 1024,
  });

  const patch = stripFence(res.content).trim();
  validateUiPatch(patch, params.screen);
  return { screen: params.screen, rpyScreenPatch: patch };
}

/** 如果 LLM 不听话包了 ``` fence,剥一层。否则原样返回。 */
function stripFence(text: string): string {
  const fenceMatch = text.match(/```(?:renpy|rpy|python)?\s*\n([\s\S]*?)\n```/);
  return fenceMatch ? fenceMatch[1]! : text;
}

export function validateUiPatch(patch: string, screen: UiDesign['screen']): void {
  if (patch.length === 0) {
    throw new Error('UI patch is empty');
  }
  // Allow blank lines and `#` comments above the `screen ...` header.
  const firstCodeLine = patch
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  if (!firstCodeLine) {
    throw new Error('UI patch has no code lines');
  }
  const header = `screen ${screen}`;
  if (!firstCodeLine.startsWith(header)) {
    throw new Error(
      `UI patch must start with \`${header}(\`, got: "${firstCodeLine.slice(0, 60)}"`,
    );
  }
  const banned: ReadonlyArray<[RegExp, string]> = [
    [/^\s*import\s+/m, 'import statement'],
    [/^\s*init\s+python/m, 'init python block'],
    [/^\s*init\s*:/m, 'init block'],
    [/^\s*default\s+/m, 'default statement'],
    [/^\s*style\s+\w/m, 'style override'],
    // `font "<path>"` would reference a file the project doesn't ship. The
    // only bundled font is SourceHanSansLite.ttf, already wired through
    // gui.text_font — text elements should inherit it, not override it.
    [/^\s*font\s+["']/m, 'font property'],
  ];
  for (const [regex, label] of banned) {
    if (regex.test(patch)) {
      throw new Error(`UI patch contains forbidden ${label}`);
    }
  }
}
