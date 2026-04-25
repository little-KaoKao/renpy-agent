import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PlannerOutput, StoryboarderOutput } from './types.js';
import type { AssetRegistryFile, AssetType } from '../assets/registry.js';
import { findByLogicalKey } from '../assets/registry.js';
import {
  logicalKeyForBgm,
  logicalKeyForCharacter,
  logicalKeyForCutscene,
  logicalKeyForScene,
  logicalKeyForSfx,
  logicalKeyForVoiceLine,
} from '../assets/logical-key.js';
import { mergeUiPatches, type UiPatch } from './ui-merge.js';

const SCENE_PALETTE = [
  '#1a2540', // deep night blue
  '#402030', // dusky purple
  '#103018', // forest green
  '#40281a', // warm brown
  '#302030', // twilight gray
  '#1a3040', // ocean teal
  '#3a2020', // burgundy
  '#203040', // steel blue
] as const;

const CHARACTER_PALETTE = [
  '#ffc0cb', // pink
  '#a0d8ef', // light blue
  '#ffe4a0', // cream
  '#d0a0ff', // lavender
  '#a0ffb4', // mint
  '#ffa0a0', // coral
  '#c0c0a0', // olive
  '#a0c0e0', // periwinkle
] as const;

const NARRATOR_IDENT = 'v'; // narrator / inner monologue
const RESERVED_IDENTS = new Set(['v', 'e', 'narrator']);

export interface GameProjectFiles {
  readonly scriptRpy: string;
  readonly optionsRpy: string;
  readonly guiRpy: string;
  readonly screensRpy: string;
}

export interface GenerateGameParams {
  readonly planner: PlannerOutput;
  readonly storyboarder: StoryboarderOutput;
  readonly assetRegistry?: AssetRegistryFile;
  /** UI Designer produced screen blocks; appended to screens.rpy by mergeUiPatches. */
  readonly uiPatches?: ReadonlyArray<UiPatch>;
}

export async function generateGameProject(
  params: GenerateGameParams,
): Promise<GameProjectFiles> {
  const scriptRpy = renderScriptRpy(params.planner, params.storyboarder, params.assetRegistry);
  const [optionsTpl, guiTpl, screensTpl] = await Promise.all([
    loadTemplate('options.rpy'),
    loadTemplate('gui.rpy'),
    loadTemplate('screens.rpy'),
  ]);
  const optionsRpy = optionsTpl
    .replaceAll('{{TITLE}}', params.planner.projectTitle)
    .replaceAll('{{BUILD_NAME}}', slugifyAscii(params.planner.projectTitle));
  const screensRpy = mergeUiPatches(screensTpl, params.uiPatches ?? []);
  return { scriptRpy, optionsRpy, guiRpy: guiTpl, screensRpy };
}

export interface WriteGameFilesParams extends GenerateGameParams {
  readonly gameDir: string;
}

export async function writeGameProject(params: WriteGameFilesParams): Promise<void> {
  const files = await generateGameProject(params);
  await mkdir(params.gameDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(params.gameDir, 'script.rpy'), files.scriptRpy, 'utf8'),
    writeFile(resolve(params.gameDir, 'options.rpy'), files.optionsRpy, 'utf8'),
    writeFile(resolve(params.gameDir, 'gui.rpy'), files.guiRpy, 'utf8'),
    writeFile(resolve(params.gameDir, 'screens.rpy'), files.screensRpy, 'utf8'),
  ]);
  // Ren'Py's default screens.rpy / gui.rpy reference binaries that the .rpy
  // templates alone don't cover: gui/button/*.png, gui/bar/*.png,
  // gui/window_icon.png, SourceHanSansLite.ttf, etc. Ship a copy of the
  // baiying-demo static pack as a default. Stage B can overwrite individual
  // pieces later via AssetRegistry.
  await copyTemplateBinaries(params.gameDir);
}

async function copyTemplateBinaries(gameDir: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const templateDir = resolve(here, '../templates');
  try {
    await copyDirectoryRecursive(templateDir, gameDir, (name) => !name.endsWith('.rpy'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // No template tree in this build (unit tests without the copy-templates
      // step). Coder is expected to still work with .rpy-only projects.
      return;
    }
    throw err;
  }
}

async function copyDirectoryRecursive(
  src: string,
  dst: string,
  filter: (name: string) => boolean = () => true,
): Promise<void> {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src);
  for (const name of entries) {
    const srcPath = resolve(src, name);
    const dstPath = resolve(dst, name);
    const st = await stat(srcPath);
    if (st.isDirectory()) {
      await copyDirectoryRecursive(srcPath, dstPath, filter);
    } else if (filter(name)) {
      await copyFile(srcPath, dstPath);
    }
  }
}

// ---------------------------------------------------------------------------
// script.rpy generator
// ---------------------------------------------------------------------------

export function renderScriptRpy(
  planner: PlannerOutput,
  storyboarder: StoryboarderOutput,
  assetRegistry?: AssetRegistryFile,
): string {
  const charIdents = assignCharacterIdentifiers(planner.characters.map((c) => c.name));
  const sceneIdents = assignSceneIdentifiers(planner.scenes.map((s) => s.name));

  const parts: string[] = [];
  parts.push(headerComment(planner.projectTitle));
  parts.push(renderImageDefinitions(planner, sceneIdents, charIdents, assetRegistry));
  parts.push(renderCharacterDefinitions(planner, charIdents));
  parts.push(renderTransforms());
  parts.push(renderMainLabel(planner, storyboarder, charIdents, sceneIdents, assetRegistry));
  return parts.join('\n\n');
}

function headerComment(title: string): string {
  return [
    '# =============================================================================',
    `# Auto-generated by renpy-agent — Stage A placeholder build`,
    `# Project: ${title}`,
    '# All visuals use Solid() / Transform placeholders. Swap real assets via',
    '# AssetRegistry in Stage B.',
    '# =============================================================================',
  ].join('\n');
}

function renderImageDefinitions(
  planner: PlannerOutput,
  sceneIdents: ReadonlyMap<string, string>,
  charIdents: ReadonlyMap<string, string>,
  assetRegistry?: AssetRegistryFile,
): string {
  const lines: string[] = ['# --- Backgrounds ---'];
  planner.scenes.forEach((s, i) => {
    const ident = sceneIdents.get(s.name)!;
    const real = lookupRealAsset(assetRegistry, 'scene_background', logicalKeyForScene(s.name));
    if (real) {
      lines.push(`image bg_${ident} = "${real}"`);
    } else {
      const color = SCENE_PALETTE[i % SCENE_PALETTE.length];
      lines.push(`image bg_${ident} = Solid("${color}")  # placeholder`);
    }
  });
  lines.push('image bg_black = Solid("#000000")');
  lines.push('');
  lines.push('# --- Character sprites ---');
  planner.characters.forEach((c, i) => {
    const ident = charIdents.get(c.name)!;
    const real = lookupRealAsset(assetRegistry, 'character_main', logicalKeyForCharacter(c.name));
    if (real) {
      lines.push(`image sprite_${ident} = "${real}"`);
    } else {
      const color = CHARACTER_PALETTE[i % CHARACTER_PALETTE.length];
      lines.push(
        `image sprite_${ident} = Transform(Solid("${color}"), size=(320, 560))  # placeholder`,
      );
    }
  });
  lines.push('');
  lines.push('# --- Particle placeholder ---');
  lines.push('image sakura_petal = Transform(Solid("#ffc0cb"), size=(8, 8))');
  lines.push('image sakura = SnowBlossom("sakura_petal", count=14, border=20, xspeed=(-25, 25), yspeed=(40, 80), fast=False, horizontal=False)');
  return lines.join('\n');
}

function renderCharacterDefinitions(
  planner: PlannerOutput,
  charIdents: ReadonlyMap<string, string>,
): string {
  const lines: string[] = ['# --- Characters ---'];
  planner.characters.forEach((c, i) => {
    const color = CHARACTER_PALETTE[i % CHARACTER_PALETTE.length];
    const ident = charIdents.get(c.name)!;
    lines.push(`define ${ident} = Character("${escapeRenpyString(c.name)}", color="${color}")`);
  });
  lines.push(`define ${NARRATOR_IDENT} = Character(None, what_color="#a0a0ff", what_italic=True)`);
  return lines.join('\n');
}

function renderTransforms(): string {
  return [
    '# --- Shot transforms (modeled after baiying-demo) ---',
    'transform stand:',
    '    xalign 0.5 yalign 1.0',
    '    zoom 0.9',
    '    alpha 0.0',
    '    ease 1.2 alpha 1.0',
    '    block:',
    '        linear 2.5 yoffset 3',
    '        linear 2.5 yoffset 0',
    '        repeat',
    '',
    'transform lookup:',
    '    xalign 0.5 yalign 1.0',
    '    ease 0.8 zoom 1.0 yoffset -10',
    '',
    'transform front:',
    '    xalign 0.5 yalign 1.0',
    '    ease 0.8 zoom 1.15 yoffset -20',
    '',
    'transform finger:',
    '    xalign 0.5 yalign 1.0',
    '    ease 0.6 zoom 1.25 yoffset -30',
    '',
    'transform forehead:',
    '    xalign 0.5 yalign 1.0',
    '    ease 0.8 zoom 1.4 yoffset -60',
    '',
    'transform heart_pulse:',
    '    ease 0.4 zoom 1.02',
    '    ease 0.4 zoom 1.0',
    '    repeat',
    '',
    'transform reset_layer:',
    '    zoom 1.0',
  ].join('\n');
}

function renderMainLabel(
  planner: PlannerOutput,
  storyboarder: StoryboarderOutput,
  charIdents: ReadonlyMap<string, string>,
  sceneIdents: ReadonlyMap<string, string>,
  assetRegistry?: AssetRegistryFile,
): string {
  const lines: string[] = ['label start:'];
  let activeScene: string | null = null;
  // Track sceneNumber across non-cutscene shots so voice lines can be keyed by
  // (sceneNumber, lineIndex) against the registry written by Voice Director.
  // v0.5 convention: sceneNumber increments on each scene change (1-indexed),
  // cutscenes reset activeScene (so the next scene-change re-triggers BGM too).
  let sceneNumber = 0;

  for (const shot of storyboarder.shots) {
    lines.push('');
    const cutsceneTag = shot.cutscene ? ` (cutscene: ${shot.cutscene.kind})` : '';
    lines.push(`    # ── Shot ${shot.shotNumber}: ${oneLine(shot.description)}${cutsceneTag} ──`);

    if (shot.cutscene) {
      const realVideo = lookupRealAsset(
        assetRegistry,
        'cutscene',
        logicalKeyForCutscene(shot.shotNumber),
      );
      if (realVideo) {
        lines.push(`    $ renpy.movie_cutscene("${realVideo}")`);
      } else {
        lines.push('    scene bg_black with fade');
        lines.push(
          `    centered "▶ Cutscene placeholder — ${escapeRenpyString(oneLine(shot.description))}"`,
        );
      }
      // Cutscene fully covers the stage; next non-cutscene shot must re-issue its scene.
      activeScene = null;
      for (let i = 0; i < shot.dialogueLines.length; i++) {
        const line = shot.dialogueLines[i]!;
        lines.push(
          ...renderDialogueLineBlock(line.speaker, line.text, charIdents, {
            sceneNumber,
            lineIndex: i,
            assetRegistry,
          }),
        );
      }
      continue;
    }

    const sceneIdent = sceneIdents.get(shot.sceneName);
    if (sceneIdent && sceneIdent !== activeScene) {
      const transition = transitionToken(shot.transition);
      lines.push(`    scene bg_${sceneIdent}${transition ? ` with ${transition}` : ''}`);
      activeScene = sceneIdent;
      sceneNumber += 1;
      // Opening a scene plays its BGM if the asset was generated; otherwise stay silent.
      const bgm = lookupRealAsset(assetRegistry, 'bgm_track', logicalKeyForBgm(shot.sceneName));
      if (bgm) {
        lines.push(`    play music "${bgm}" fadeout 1.0`);
      }
    }

    // SFX enter cue: plays before visuals resolve so it covers the transition.
    // TODO(v0.6): handle action/ambient cues. Exit cue fires after dialogueLines below.
    const sfxEnter = lookupRealAsset(
      assetRegistry,
      'sfx',
      logicalKeyForSfx(shot.shotNumber, 'enter'),
    );
    if (sfxEnter) {
      lines.push(`    play sound "${sfxEnter}"`);
    }

    if (mentions(shot.effects, 'sakura') || mentions(shot.effects, 'particle')) {
      lines.push('    show sakura');
    }

    const transformName = pickTransform(shot.transforms, shot.staging);
    for (const charName of shot.characters) {
      const ident = charIdents.get(charName);
      if (!ident) continue;
      lines.push(`    show sprite_${ident} at ${transformName}`);
    }

    if (mentions(shot.transforms, 'heart_pulse') || mentions(shot.staging, 'heart_pulse')) {
      lines.push('    show layer master at heart_pulse');
    }
    if (mentions(shot.transforms, 'reset') || mentions(shot.staging, 'reset')) {
      lines.push('    show layer master at reset_layer');
    }

    for (let i = 0; i < shot.dialogueLines.length; i++) {
      const line = shot.dialogueLines[i]!;
      lines.push(
        ...renderDialogueLineBlock(line.speaker, line.text, charIdents, {
          sceneNumber,
          lineIndex: i,
          assetRegistry,
        }),
      );
    }

    const sfxExit = lookupRealAsset(
      assetRegistry,
      'sfx',
      logicalKeyForSfx(shot.shotNumber, 'exit'),
    );
    if (sfxExit) {
      lines.push(`    play sound "${sfxExit}"`);
    }
  }

  lines.push('');
  lines.push('    # ── End ──');
  lines.push('    scene bg_black with Fade(1.0, 1.5, 1.5, color="#000")');
  lines.push(`    centered "── ${escapeRenpyString(planner.projectTitle)} · Stage A demo ──"`);
  lines.push('    return');

  return lines.join('\n');
}

interface VoiceContext {
  readonly sceneNumber: number;
  readonly lineIndex: number;
  readonly assetRegistry?: AssetRegistryFile;
}

/**
 * Render a dialogue line, optionally prefixed by a `voice "..."` line when the
 * registry has a ready voice_line asset. Ren'Py semantics: a `voice` statement
 * is consumed by the next `say`, so they stay together as a 2-line block.
 */
function renderDialogueLineBlock(
  speaker: string,
  text: string,
  charIdents: ReadonlyMap<string, string>,
  ctx: VoiceContext,
): string[] {
  const out: string[] = [];
  if (ctx.sceneNumber > 0) {
    const voice = lookupRealAsset(
      ctx.assetRegistry,
      'voice_line',
      logicalKeyForVoiceLine(ctx.sceneNumber, ctx.lineIndex),
    );
    if (voice) {
      out.push(`    voice "${voice}"`);
    }
  }
  out.push(renderDialogueLine(speaker, text, charIdents));
  return out;
}

function renderDialogueLine(
  speaker: string,
  text: string,
  charIdents: ReadonlyMap<string, string>,
): string {
  const ident = charIdents.get(speaker);
  const escaped = escapeRenpyString(text);
  if (ident) {
    return `    ${ident} "${escaped}"`;
  }
  return `    ${NARRATOR_IDENT} "${escaped}"`;
}

// ---------------------------------------------------------------------------
// Identifier assignment & sanitization
// ---------------------------------------------------------------------------

export function assignCharacterIdentifiers(
  names: ReadonlyArray<string>,
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>([NARRATOR_IDENT]);
  for (const name of names) {
    const base = slugToIdent(name) || 'ch';
    let candidate = base;
    let i = 2;
    while (used.has(candidate) || RESERVED_IDENTS.has(candidate) || isRenpyKeyword(candidate)) {
      candidate = `${base}${i++}`;
    }
    used.add(candidate);
    result.set(name, candidate);
  }
  return result;
}

export function assignSceneIdentifiers(
  names: ReadonlyArray<string>,
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    const base = slugToIdent(name) || 'scene';
    let candidate = base;
    let i = 2;
    while (used.has(candidate) || isRenpyKeyword(candidate)) {
      candidate = `${base}${i++}`;
    }
    used.add(candidate);
    result.set(name, candidate);
  }
  return result;
}

function slugToIdent(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii.length === 0) return '';
  if (/^[0-9]/.test(ascii)) return `_${ascii}`;
  return ascii;
}

// ---------------------------------------------------------------------------
// AssetRegistry lookup (Stage B ↔ Stage A binding)
// ---------------------------------------------------------------------------
// logicalKeyFor* helpers live in ../assets/logical-key.ts — shared by Coder
// and executers so that the key read here matches the key written by each
// generator.

function lookupRealAsset(
  registry: AssetRegistryFile | undefined,
  assetType: AssetType,
  logicalKey: string,
): string | undefined {
  if (!registry) return undefined;
  const entry = findByLogicalKey(registry, logicalKey);
  if (!entry || entry.assetType !== assetType || entry.status !== 'ready') return undefined;
  return entry.realAssetLocalPath;
}

function slugifyAscii(value: string): string {
  const ascii = value.replace(/[^A-Za-z0-9]+/g, '');
  return ascii || 'AgenticGalgame';
}

function isRenpyKeyword(ident: string): boolean {
  return [
    'label', 'scene', 'show', 'hide', 'jump', 'call', 'return', 'menu',
    'image', 'define', 'default', 'init', 'python', 'if', 'elif', 'else',
    'while', 'pass', 'play', 'stop', 'queue', 'voice', 'pause', 'window',
    'with', 'at', 'as', 'behind', 'onlayer', 'expression', 'in', 'not', 'and', 'or',
    'True', 'False', 'None',
  ].includes(ident);
}

function escapeRenpyString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function mentions(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function transitionToken(transition: string): string | null {
  const t = transition.toLowerCase();
  if (t.includes('fade')) return 'fade';
  if (t.includes('dissolve')) return 'dissolve';
  return null;
}

function pickTransform(transforms: string, staging: string): string {
  const source = `${transforms} ${staging}`.toLowerCase();
  if (source.includes('forehead')) return 'forehead';
  if (source.includes('finger')) return 'finger';
  if (source.includes('front') || source.includes('lean')) return 'front';
  if (source.includes('lookup') || source.includes('look up')) return 'lookup';
  return 'stand';
}

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

const templateCache = new Map<string, string>();

async function loadTemplate(name: string): Promise<string> {
  const cached = templateCache.get(name);
  if (cached !== undefined) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  // In source tree: src/pipeline/ → ../templates/
  // In dist tree:   dist/pipeline/ → ../templates/ (copy-templates.mjs mirrors layout)
  const templatePath = resolve(here, '../templates', name);
  const content = await readFile(templatePath, 'utf8');
  templateCache.set(name, content);
  return content;
}
