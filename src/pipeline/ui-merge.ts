// UI 补丁 merge:把 UI Designer 产的 `screen <name>():` 代码块追加到 screens.rpy 末尾。
//
// Ren'Py 的 `screen foo():` 遵循"后定义覆盖先定义",所以把生成的 screen block
// 直接追加在官方 screens.rpy 后面,等价于用新定义覆盖内置定义 —— 不需要 AST 级别
// 的 patch/替换,也不需要 Python ast 处理。
//
// 每段补丁前后各加一条分隔注释,方便 diff / review / 回滚。

export interface UiPatch {
  readonly screen: string;
  readonly patch: string;
}

const PATCH_MARKER = '# === renpy-agent UI patch';

export function mergeUiPatches(
  baseScreensRpy: string,
  patches: ReadonlyArray<UiPatch>,
): string {
  if (patches.length === 0) return baseScreensRpy;

  const sections: string[] = [];
  for (const { screen, patch } of patches) {
    const trimmed = patch.trim();
    if (trimmed.length === 0) continue;
    sections.push('');
    sections.push(`${PATCH_MARKER}: ${screen} ===`);
    sections.push(trimmed);
    sections.push(`${PATCH_MARKER} end: ${screen} ===`);
  }
  if (sections.length === 0) return baseScreensRpy;

  const base = baseScreensRpy.endsWith('\n') ? baseScreensRpy : baseScreensRpy + '\n';
  return base + sections.join('\n') + '\n';
}
