// UI 设计师:screens.rpy 补丁生成入口。
//
// v0.7:LLM 不再直接输出 Ren'Py 代码字符串。它调 `emit_ui_design` tool 返回结构化
// JSON(headerText / buttons / bgColor / layout),由纯 TS renderer 把 JSON 编译成
// 合法 Ren'Py screen block。LLM 根本摸不到 `.rpy` 文本,也就不存在"意外写出
// init python / import / font 覆盖"这种黑名单式的攻击面。
//
// 和其余 audio/image executer 不同,**不走 RunningHub**,不进 AssetRegistry —— 产物是
// 一段合法的 Ren'Py screen block 字符串,Coder 在 merge 阶段直接追加到 screens.rpy 末尾,
// 利用 Ren'Py "后定义 screen 覆盖先定义"的语义覆盖内置 screen。

import type {
  LlmClient,
  LlmToolChatResponse,
  LlmToolUseBlock,
} from '../../llm/types.js';
import type { UiDesign } from '../../schema/galgame-workspace.js';

export interface UiPatchButton {
  readonly label: string;
  readonly action: string;
}

export interface UiPatchDesign {
  readonly headerText: string;
  readonly buttons: ReadonlyArray<UiPatchButton>;
  readonly bgColor?: string;
  readonly layout?: 'vbox' | 'hbox';
}

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

const UI_PATCH_SYSTEM_PROMPT = `You are the UI Designer for a Ren'Py visual novel.
You design ONE screen at a time. Call the tool \`emit_ui_design\` exactly once with a
structured design (title header text, buttons, optional bg color, optional layout).

Do NOT write Ren'Py code. A downstream pure-TS renderer compiles your structured
design into the actual screen block. You only choose content and mood.

Constraints:
- Labels and button actions must be plain strings with no quotes, backslashes, or newlines.
- bgColor, if set, must be a #rrggbb hex string.
- Keep the button list short (2-5 items).`;

const UI_PATCH_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    headerText: {
      type: 'string',
      description: 'The large title text displayed on the screen (e.g. project title).',
    },
    layout: {
      type: 'string',
      enum: ['vbox', 'hbox'],
      description: 'Stack direction for buttons. Defaults to vbox.',
    },
    bgColor: {
      type: 'string',
      description: 'Optional background color as #rrggbb hex.',
    },
    buttons: {
      type: 'array',
      minItems: 0,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Visible button label, plain text.' },
          action: {
            type: 'string',
            description:
              "Ren'Py action expression, e.g. Start() / ShowMenu(\"load\") / Quit(confirm=False)",
          },
        },
        required: ['label', 'action'],
      },
    },
  },
  required: ['headerText', 'buttons'],
} as const;

export async function generateUiPatch(
  params: GenerateUiPatchParams,
): Promise<GenerateUiPatchResult> {
  if (!params.llmClient.chatWithTools) {
    throw new Error('generateUiPatch requires an LlmClient that supports chatWithTools.');
  }

  const userMsg = [
    `Project title: ${params.projectTitle}`,
    `Screen to override: ${params.screen}`,
    `Visual mood: ${params.moodTag}`,
    '',
    `Emit the UI design by calling emit_ui_design. Use "${params.projectTitle}" as the headerText` +
      ` unless the screen meaning demands otherwise (e.g. "Load Game" for save_load).`,
  ].join('\n');

  const res = await params.llmClient.chatWithTools({
    messages: [
      { role: 'system', content: UI_PATCH_SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    tools: [
      {
        name: 'emit_ui_design',
        description: 'Emit the UI design for a single Ren\'Py screen as a structured tool call.',
        inputSchema: UI_PATCH_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
    temperature: params.temperature ?? 0.6,
    maxTokens: params.maxTokens ?? 1024,
  });

  const design = parseDesign(res);
  const patch = renderUiPatch({
    screen: params.screen,
    moodTag: params.moodTag,
    design,
  });
  validateUiPatch(patch, params.screen);
  return { screen: params.screen, rpyScreenPatch: patch };
}

function parseDesign(res: LlmToolChatResponse): UiPatchDesign {
  const toolUse = res.content.find(
    (b): b is LlmToolUseBlock => b.type === 'tool_use' && b.name === 'emit_ui_design',
  );
  if (!toolUse) {
    throw new Error('LLM did not call tool emit_ui_design');
  }
  const input = toolUse.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== 'object') {
    throw new Error('emit_ui_design input is not an object');
  }
  if (typeof input.headerText !== 'string' || input.headerText.length === 0) {
    throw new Error('emit_ui_design: headerText must be a non-empty string');
  }
  if (!Array.isArray(input.buttons)) {
    throw new Error('emit_ui_design: buttons must be an array');
  }
  const buttons: UiPatchButton[] = [];
  for (const [i, raw] of input.buttons.entries()) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`emit_ui_design: buttons[${i}] is not an object`);
    }
    const b = raw as Record<string, unknown>;
    if (typeof b.label !== 'string' || b.label.length === 0) {
      throw new Error(`emit_ui_design: buttons[${i}].label must be a non-empty string`);
    }
    if (typeof b.action !== 'string' || b.action.length === 0) {
      throw new Error(`emit_ui_design: buttons[${i}].action must be a non-empty string`);
    }
    assertSafeLiteral(b.label, `button label[${i}]`);
    assertSafeAction(b.action, `button action[${i}]`);
    buttons.push({ label: b.label, action: b.action });
  }
  const headerText = input.headerText;
  assertSafeLiteral(headerText, 'headerText');

  const design: {
    headerText: string;
    buttons: ReadonlyArray<UiPatchButton>;
    bgColor?: string;
    layout?: 'vbox' | 'hbox';
  } = { headerText, buttons };

  if (input.bgColor !== undefined) {
    if (typeof input.bgColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.bgColor)) {
      throw new Error('emit_ui_design: bgColor must be a #rrggbb hex string');
    }
    design.bgColor = input.bgColor;
  }
  if (input.layout !== undefined) {
    if (input.layout !== 'vbox' && input.layout !== 'hbox') {
      throw new Error('emit_ui_design: layout must be "vbox" or "hbox"');
    }
    design.layout = input.layout;
  }
  return design;
}

function assertSafeLiteral(text: string, where: string): void {
  if (/["\\\n\r]/.test(text)) {
    throw new Error(`${where} contains disallowed characters (quote/backslash/newline)`);
  }
}

function assertSafeAction(text: string, where: string): void {
  // Allow letters, digits, underscore, parens, quotes, dots, commas, equals, spaces,
  // and plain ASCII punctuation typical for Ren'Py actions like Start() / ShowMenu("load")
  // / Quit(confirm=False). Reject newlines and backslashes.
  if (/[\n\r\\]/.test(text)) {
    throw new Error(`${where} contains disallowed characters (newline/backslash)`);
  }
}

export interface RenderUiPatchParams {
  readonly screen: UiDesign['screen'];
  readonly moodTag: string;
  readonly design: UiPatchDesign;
}

export function renderUiPatch(params: RenderUiPatchParams): string {
  const { screen, moodTag, design } = params;
  const layout = design.layout ?? 'vbox';
  const lines: string[] = [];
  lines.push(`# --- ui-patch: ${screen} (mood: ${moodTag}) ---`);
  lines.push(`screen ${screen}():`);
  lines.push(`    tag menu`);
  if (design.bgColor) {
    lines.push(`    add Solid("${design.bgColor}")`);
  }
  lines.push(`    ${layout}:`);
  lines.push(`        xalign 0.5 yalign 0.4`);
  lines.push(`        text "${design.headerText}" size 60`);
  for (const btn of design.buttons) {
    lines.push(`        textbutton "${btn.label}" action ${btn.action}`);
  }
  return lines.join('\n') + '\n';
}

export function validateUiPatch(patch: string, screen: UiDesign['screen']): void {
  if (patch.trim().length === 0) {
    throw new Error('UI patch is empty');
  }
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
}
