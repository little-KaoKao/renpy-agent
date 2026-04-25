import { describe, expect, it } from 'vitest';
import { mergeUiPatches } from './ui-merge.js';

const BASE = `# default screens.rpy
screen say(who, what):
    pass
`;

describe('mergeUiPatches', () => {
  it('returns base untouched when patches is empty', () => {
    expect(mergeUiPatches(BASE, [])).toBe(BASE);
  });

  it('returns base untouched when all patches are blank', () => {
    expect(mergeUiPatches(BASE, [{ screen: 'main_menu', patch: '   \n' }])).toBe(BASE);
  });

  it('appends each patch with marker comments in order', () => {
    const merged = mergeUiPatches(BASE, [
      { screen: 'main_menu', patch: 'screen main_menu():\n    pass' },
      { screen: 'save_load', patch: 'screen save_load():\n    pass' },
    ]);
    expect(merged).toContain('# === renpy-agent UI patch: main_menu ===');
    expect(merged).toContain('# === renpy-agent UI patch end: main_menu ===');
    expect(merged).toContain('# === renpy-agent UI patch: save_load ===');
    // Ordering: main_menu section precedes save_load section.
    const idxMain = merged.indexOf('UI patch: main_menu ===');
    const idxSave = merged.indexOf('UI patch: save_load ===');
    expect(idxMain).toBeGreaterThan(-1);
    expect(idxSave).toBeGreaterThan(idxMain);
  });

  it('preserves base content verbatim before appended patches', () => {
    const merged = mergeUiPatches(BASE, [
      { screen: 'main_menu', patch: 'screen main_menu():\n    pass' },
    ]);
    expect(merged.startsWith(BASE)).toBe(true);
  });

  it('adds a trailing newline after patches', () => {
    const merged = mergeUiPatches(BASE, [
      { screen: 'main_menu', patch: 'screen main_menu():\n    pass' },
    ]);
    expect(merged.endsWith('\n')).toBe(true);
  });
});
