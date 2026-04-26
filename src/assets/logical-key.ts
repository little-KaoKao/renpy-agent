// Logical keys for AssetRegistry entries.
//
// One source of truth for "how we key Stage-A placeholders against Stage-B
// real assets". Both Coder (reader) and executers (writer) import from here.
//
// Rules:
//   - Slug-based keys use `slugForFilename` so the key lines up with the
//     on-disk path (`audio/bgm/<slug>.flac`), and non-ASCII names fall back
//     to a stable `'asset'` instead of an empty string.
//   - Index-based keys (voice / sfx / cutscene) don't need a slug; the
//     shot / scene / line indices are already stable.
//
// Reason this lives under `assets/` rather than `pipeline/`: executers must
// not import from `pipeline/` (that would flip the dependency direction),
// but both can depend on `assets/`.

import { slugForFilename } from './download.js';

export function logicalKeyForCharacter(name: string): string {
  return `character:${slugForFilename(name)}:main`;
}

export function logicalKeyForCharacterExpression(
  characterName: string,
  expressionName: string,
): string {
  return `character:${slugForFilename(characterName)}:expr:${slugForFilename(expressionName)}`;
}

export function logicalKeyForCharacterDynamicSprite(characterName: string): string {
  return `character:${slugForFilename(characterName)}:dynamic`;
}

export function logicalKeyForScene(name: string): string {
  return `scene:${slugForFilename(name)}:bg`;
}

export function logicalKeyForSceneTimeVariant(
  sceneName: string,
  timeOfDay: string,
): string {
  return `scene:${slugForFilename(sceneName)}:time:${slugForFilename(timeOfDay)}`;
}

export function logicalKeyForProp(name: string): string {
  return `prop:${slugForFilename(name)}`;
}

export function logicalKeyForBgm(name: string): string {
  return `bgm:${slugForFilename(name)}`;
}

export function logicalKeyForVoiceLine(shotNumber: number, lineIndex: number): string {
  return `voice:shot_${shotNumber}:line_${lineIndex}`;
}

export type SfxCue = 'enter' | 'action' | 'exit' | 'ambient';

export function logicalKeyForSfx(shotNumber: number, cue: SfxCue): string {
  return `sfx:shot_${shotNumber}:${cue}`;
}

export function logicalKeyForCutscene(shotNumber: number): string {
  return `cutscene:shot_${shotNumber}`;
}
