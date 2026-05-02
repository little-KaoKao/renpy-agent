// Accepts both v0.7 enum-shaped shots and pre-v0.7 free-string shots; falls
// back to `stand` / `solo_center` / `[]` on unknown values and emits exactly
// one warn per (kind, rawValue) pair over the process lifetime.

import {
  SHOT_STAGING,
  SHOT_TRANSFORMS,
  SHOT_TRANSITIONS,
  SHOT_EFFECTS,
  type ShotEffect,
  type ShotStaging,
  type ShotTransform,
  type ShotTransition,
  type StoryboarderOutputShot,
} from './types.js';

export type LegacyWarnFn = (kind: string, rawValue: string) => void;

const warnedPairs = new Set<string>();

function defaultWarn(kind: string, rawValue: string): void {
  const key = `${kind}:${rawValue.toLowerCase()}`;
  if (warnedPairs.has(key)) return;
  warnedPairs.add(key);
  console.warn(
    `[storyboarder-enum] legacy shot field "${kind}"="${rawValue}" does not match any enum; falling back.`,
  );
}

export function resetLegacyWarnDedup(): void {
  warnedPairs.clear();
}

function isEnumMember<T extends string>(values: ReadonlyArray<T>, v: unknown): v is T {
  return typeof v === 'string' && (values as ReadonlyArray<string>).includes(v);
}

const STAGING_ALIASES: ReadonlyMap<string, ShotStaging> = new Map([
  ['solo_center', 'solo_center'],
  ['solo_left', 'solo_left'],
  ['solo_right', 'solo_right'],
  ['two_shot', 'two_shot'],
  ['group', 'group'],
  ['none', 'none'],
  // legacy prose → closest enum
  ['center', 'solo_center'],
  ['mid', 'solo_center'],
  ['enter', 'solo_center'],
  ['left', 'solo_left'],
  ['right', 'solo_right'],
  ['pan', 'solo_center'],
  ['lookup', 'solo_center'],
  ['front', 'solo_center'],
]);

const TRANSFORM_ALIASES: ReadonlyMap<string, ShotTransform> = new Map(
  SHOT_TRANSFORMS.map((t) => [t, t] as const),
);

const EFFECT_KEYWORDS: ReadonlyArray<[RegExp, ShotEffect]> = [
  [/sakura|petal|blossom|樱花/i, 'sakura'],
  [/snow|flake|雪/i, 'snow'],
  [/rain|drizzle|storm|雨/i, 'rain'],
  [/lens ?flare|bloom|glow|光斑/i, 'lensflare'],
];

function pickTransform(raw: string, warn: LegacyWarnFn): ShotTransform {
  const lower = raw.toLowerCase().trim();
  if (!lower) return 'stand';
  const direct = TRANSFORM_ALIASES.get(lower);
  if (direct) return direct;
  for (const candidate of SHOT_TRANSFORMS) {
    if (lower.includes(candidate)) return candidate;
  }
  if (/\blean\b|\blean in\b/.test(lower)) return 'front';
  if (/\blook up\b/.test(lower)) return 'lookup';
  warn('transform', raw);
  return 'stand';
}

function pickStaging(raw: string, warn: LegacyWarnFn): ShotStaging {
  const lower = raw.toLowerCase().trim();
  if (!lower) return 'solo_center';
  const alias = STAGING_ALIASES.get(lower);
  if (alias) return alias;
  for (const value of SHOT_STAGING) {
    if (lower.includes(value)) return value;
  }
  if (lower.includes('two')) return 'two_shot';
  if (lower.includes('group') || lower.includes('crowd')) return 'group';
  warn('staging', raw);
  return 'solo_center';
}

function matchEffectKeyword(value: string): ShotEffect | null {
  for (const [pattern, effect] of EFFECT_KEYWORDS) {
    if (pattern.test(value)) return effect;
  }
  return null;
}

function pickEffects(raw: unknown, warn: LegacyWarnFn): ShotEffect[] {
  if (Array.isArray(raw)) {
    const out: ShotEffect[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      if (isEnumMember(SHOT_EFFECTS, item)) {
        out.push(item);
        continue;
      }
      const legacyMatch = matchEffectKeyword(item);
      if (legacyMatch && legacyMatch !== 'none') out.push(legacyMatch);
      else if (item.trim().length > 0) warn('effects', item);
    }
    return Array.from(new Set(out));
  }
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    const legacyMatch = matchEffectKeyword(raw);
    if (legacyMatch && legacyMatch !== 'none') return [legacyMatch];
    warn('effects', raw);
    return [];
  }
  return [];
}

function pickTransition(raw: unknown, warn: LegacyWarnFn): ShotTransition {
  if (typeof raw !== 'string') return 'none';
  const lower = raw.toLowerCase().trim();
  if (!lower) return 'none';
  if (isEnumMember(SHOT_TRANSITIONS, lower)) return lower;
  if (lower.includes('fade')) return 'fade';
  if (lower.includes('dissolve')) return 'dissolve';
  if (lower === 'cut') return 'none';
  warn('transition', raw);
  return 'none';
}

function resolveTransform(src: Record<string, unknown>, warn: LegacyWarnFn): ShotTransform {
  // Prefer the v0.7 `transform` field when it's a valid enum member; otherwise
  // fall through to legacy `transforms` prose, then to raw `transform` prose.
  if (isEnumMember(SHOT_TRANSFORMS, src.transform)) return src.transform;
  if (typeof src.transforms === 'string') return pickTransform(src.transforms, warn);
  if (typeof src.transform === 'string') return pickTransform(src.transform, warn);
  return 'stand';
}

function resolveStaging(src: Record<string, unknown>, warn: LegacyWarnFn): ShotStaging {
  if (isEnumMember(SHOT_STAGING, src.staging)) return src.staging;
  if (typeof src.staging === 'string') return pickStaging(src.staging, warn);
  return 'solo_center';
}

/**
 * Normalize a single shot to v0.7 enum shape.
 *
 * Unknown values fall back to `stand` / `solo_center` / `[]` and emit one
 * warn per unique (kind, rawValue) pair across the process lifetime.
 */
export function normalizeShot(
  raw: unknown,
  warn: LegacyWarnFn = defaultWarn,
): StoryboarderOutputShot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('normalizeShot: input is not an object');
  }
  const src = raw as Record<string, unknown>;

  const transform = resolveTransform(src, warn);
  const staging = resolveStaging(src, warn);
  const effects = pickEffects(src.effects, warn);
  const transition = pickTransition(src.transition, warn);

  const legacyTransforms = typeof src.transforms === 'string' ? src.transforms : undefined;
  const legacyStaging = typeof src.staging === 'string' ? src.staging : undefined;

  const shotNumber = typeof src.shotNumber === 'number' ? src.shotNumber : 0;
  const description = typeof src.description === 'string' ? src.description : '';
  const characters = Array.isArray(src.characters)
    ? src.characters.filter((c): c is string => typeof c === 'string')
    : [];
  const sceneName = typeof src.sceneName === 'string' ? src.sceneName : '';
  const dialogueLines = Array.isArray(src.dialogueLines)
    ? src.dialogueLines.filter(
        (l): l is { speaker: string; text: string } =>
          !!l &&
          typeof l === 'object' &&
          typeof (l as Record<string, unknown>).speaker === 'string' &&
          typeof (l as Record<string, unknown>).text === 'string',
      )
    : [];
  const cutscene = src.cutscene as StoryboarderOutputShot['cutscene'];

  return {
    shotNumber,
    description,
    characters,
    sceneName,
    staging,
    transform,
    transition,
    effects,
    dialogueLines,
    ...(legacyTransforms !== undefined && legacyTransforms !== transform
      ? { transforms_raw: legacyTransforms }
      : {}),
    ...(legacyStaging !== undefined && legacyStaging !== staging
      ? { staging_raw: legacyStaging }
      : {}),
    ...(typeof src.effects === 'string' && src.effects.trim().length > 0
      ? { effects_raw: src.effects }
      : {}),
    ...(cutscene ? { cutscene } : {}),
  };
}

export function normalizeStoryboarderOutput<T extends { shots: ReadonlyArray<unknown> }>(
  raw: T,
  warn: LegacyWarnFn = defaultWarn,
): T & { shots: ReadonlyArray<StoryboarderOutputShot> } {
  const shots = raw.shots.map((s) => normalizeShot(s, warn));
  return { ...raw, shots };
}
