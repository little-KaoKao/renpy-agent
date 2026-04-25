#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ClaudeLlmClient } from './llm/claude-client.js';
import {
  HttpRunningHubClient,
  type RunningHubClient,
} from './executers/common/runninghub-client.js';
import { RUNNINGHUB_APP_SCHEMAS } from './executers/common/runninghub-schemas.js';
import { runPipeline, slugifyStoryName } from './pipeline/run-pipeline.js';
import {
  modifyCharacterAppearance,
  modifyDialogueLine,
  reorderShots,
} from './pipeline/modify.js';
import { rebuildGameProject } from './pipeline/rebuild.js';

export type ParsedCliCommand =
  | {
      readonly kind: 'generate';
      readonly inspiration: string;
      readonly storyName?: string;
      readonly audioUi?: boolean;
      readonly cutscene?: boolean;
      readonly resume?: boolean;
    }
  | {
      readonly kind: 'modify';
      readonly op: 'character';
      readonly storyName: string;
      readonly characterName: string;
      readonly visualDescription: string;
      readonly rebuild: boolean;
    }
  | {
      readonly kind: 'modify';
      readonly op: 'dialogue';
      readonly storyName: string;
      readonly shotNumber: number;
      readonly lineIndex: number;
      readonly text: string;
      readonly rebuild: boolean;
    }
  | {
      readonly kind: 'modify';
      readonly op: 'shots';
      readonly storyName: string;
      readonly order: ReadonlyArray<number>;
      readonly rebuild: boolean;
    }
  | { readonly kind: 'rebuild'; readonly storyName: string }
  | { readonly kind: 'help' };

const KNOWN_SUBCOMMANDS = new Set(['generate', 'modify', 'rebuild']);

export function parseArgs(argv: ReadonlyArray<string>): ParsedCliCommand {
  if (argv.some((a) => a === '--help' || a === '-h')) return { kind: 'help' };
  const head = argv[0];
  if (head === 'generate') return parseGenerateArgs(argv.slice(1));
  if (head === 'modify') return parseModifyArgs(argv.slice(1));
  if (head === 'rebuild') return parseRebuildArgs(argv.slice(1));
  // Legacy form: `renpy-agent <inspiration...>` with optional --name / --audio-ui.
  if (head !== undefined && KNOWN_SUBCOMMANDS.has(head)) {
    // Should be unreachable given the checks above, but makes the type narrow tight.
    throw new Error(`internal: unhandled subcommand "${head}"`);
  }
  return parseGenerateArgs(argv);
}

function parseGenerateArgs(argv: ReadonlyArray<string>): ParsedCliCommand {
  let storyName: string | undefined;
  let audioUi = false;
  let cutscene = false;
  let resume = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--audio-ui') {
      audioUi = true;
    } else if (arg === '--cutscene') {
      cutscene = true;
    } else if (arg === '--resume') {
      resume = true;
    } else if (arg === '--name') {
      const next = argv[i + 1];
      if (!next) throw new Error('--name requires a value');
      storyName = next;
      i++;
    } else if (arg.startsWith('--name=')) {
      storyName = arg.slice('--name='.length);
    } else {
      positional.push(arg);
    }
  }
  const inspiration = positional.join(' ').trim();
  const result: ParsedCliCommand = { kind: 'generate', inspiration };
  if (storyName !== undefined) (result as { storyName?: string }).storyName = storyName;
  if (audioUi) (result as { audioUi?: boolean }).audioUi = true;
  if (cutscene) (result as { cutscene?: boolean }).cutscene = true;
  if (resume) (result as { resume?: boolean }).resume = true;
  return result;
}

function parseModifyArgs(argv: ReadonlyArray<string>): ParsedCliCommand {
  const op = argv[0];
  if (op !== 'character' && op !== 'dialogue' && op !== 'shots') {
    throw new Error(
      `modify: unknown operation "${op ?? '<missing>'}". Expected "character", "dialogue", or "shots".`,
    );
  }
  const storyName = argv[1];
  if (!storyName || storyName.startsWith('-')) {
    throw new Error(`modify ${op}: <story> is required (e.g. \`renpy-agent modify ${op} my-story ...\`)`);
  }
  const rest = argv.slice(2);
  const flags = readFlags(rest);
  const rebuild = flags.has('rebuild');

  if (op === 'character') {
    const characterName = requireFlag(flags, 'name', 'modify character');
    const visualDescription = requireFlag(flags, 'visual', 'modify character');
    return {
      kind: 'modify',
      op: 'character',
      storyName,
      characterName,
      visualDescription,
      rebuild,
    };
  }
  if (op === 'dialogue') {
    const shotNumber = parseIntFlag(flags, 'shot', 'modify dialogue');
    const lineIndex = parseIntFlag(flags, 'line', 'modify dialogue');
    const text = requireFlag(flags, 'text', 'modify dialogue');
    return {
      kind: 'modify',
      op: 'dialogue',
      storyName,
      shotNumber,
      lineIndex,
      text,
      rebuild,
    };
  }
  // shots
  const order = parseOrderFlag(flags, 'modify shots');
  return { kind: 'modify', op: 'shots', storyName, order, rebuild };
}

function parseRebuildArgs(argv: ReadonlyArray<string>): ParsedCliCommand {
  const storyName = argv[0];
  if (!storyName || storyName.startsWith('-')) {
    throw new Error('rebuild: <story> is required (e.g. `renpy-agent rebuild my-story`)');
  }
  return { kind: 'rebuild', storyName };
}

type FlagMap = Map<string, string | true>;

function readFlags(argv: ReadonlyArray<string>): FlagMap {
  const out: FlagMap = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected positional argument: "${arg}"`);
    }
    const eq = arg.indexOf('=');
    if (eq > 2) {
      out.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out.set(name, true);
    } else {
      out.set(name, next);
      i++;
    }
  }
  return out;
}

function requireFlag(flags: FlagMap, name: string, context: string): string {
  const v = flags.get(name);
  if (v === undefined) throw new Error(`${context}: --${name} is required`);
  if (v === true) throw new Error(`${context}: --${name} requires a value`);
  return v;
}

function parseIntFlag(flags: FlagMap, name: string, context: string): number {
  const raw = requireFlag(flags, name, context);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim()) {
    throw new Error(`${context}: --${name} must be an integer, got "${raw}"`);
  }
  return n;
}

function parseOrderFlag(flags: FlagMap, context: string): ReadonlyArray<number> {
  const raw = requireFlag(flags, 'order', context);
  const parts = raw.split(',').map((s) => s.trim());
  const out: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isFinite(n) || String(n) !== p) {
      throw new Error(`${context}: --order expects comma-separated integers, got "${raw}"`);
    }
    out.push(n);
  }
  if (out.length === 0) {
    throw new Error(`${context}: --order must contain at least one integer`);
  }
  return out;
}

const HELP_TEXT = `Usage:
  renpy-agent generate [--name <slug>] [--audio-ui] [--cutscene] <inspiration text>
  renpy-agent modify character <story> --name <name> --visual "..." [--rebuild]
  renpy-agent modify dialogue  <story> --shot <N> --line <i> --text "..." [--rebuild]
  renpy-agent modify shots     <story> --order 3,1,2,4,5,6,7,8 [--rebuild]
  renpy-agent rebuild <story>
  renpy-agent -h | --help

Legacy form (still supported):
  renpy-agent [--name <slug>] [--audio-ui] [--cutscene] [--resume] <inspiration text>

Options:
  --name <slug>   Story folder name (defaults to "story-YYYYMMDD-HHMMSS")
  --audio-ui      Enable v0.5 audio + UI stage (BGM / voice / SFX / main_menu patch).
                  Requires RUNNINGHUB_API_KEY in the environment.
                  Equivalent env flag: RENPY_AGENT_AUDIO_UI=1 (CLI flag wins).
  --cutscene      Auto-route storyboarder shot.cutscene entries to Seedance2.0
                  image-to-video. Requires RUNNINGHUB_API_KEY. Reference first-frames
                  are pulled from already-ready scene/character assets in the registry;
                  shots without a ready reference fall back to the Stage A placeholder.
  --resume        Reuse any planner.json / writer.json / storyboarder.json that
                  already exists under the story's workspace dir and skip those
                  LLM stages. Lets you recover from a mid-pipeline failure
                  without re-burning tokens on stages that already succeeded.
  --rebuild       After a modify, regenerate script.rpy and run QA.
  -h, --help      Show this help

Environment:
  ANTHROPIC_API_KEY    required for generate (loaded from .env via "node --env-file=.env ...")
  RUNNINGHUB_API_KEY   required when --audio-ui or --cutscene is enabled
`;

export async function main(argv: ReadonlyArray<string>): Promise<number> {
  let cmd: ParsedCliCommand;
  try {
    cmd = parseArgs(argv);
  } catch (err) {
    console.error(String((err as Error).message));
    console.error(HELP_TEXT);
    return 1;
  }
  if (cmd.kind === 'help') {
    console.log(HELP_TEXT);
    return 0;
  }
  if (cmd.kind === 'generate') return runGenerate(cmd);
  if (cmd.kind === 'modify') return runModify(cmd);
  return runRebuild(cmd);
}

type GenerateCommand = Extract<ParsedCliCommand, { kind: 'generate' }>;
type ModifyCommand = Extract<ParsedCliCommand, { kind: 'modify' }>;
type RebuildCommand = Extract<ParsedCliCommand, { kind: 'rebuild' }>;

async function runGenerate(cmd: GenerateCommand): Promise<number> {
  if (!cmd.inspiration) {
    console.error('Error: inspiration text is required.');
    console.error(HELP_TEXT);
    return 1;
  }
  const storyName = slugifyStoryName(cmd.storyName);
  const llm = new ClaudeLlmClient();

  const enableAudioUi = cmd.audioUi ?? process.env.RENPY_AGENT_AUDIO_UI === '1';
  const enableCutscene = cmd.cutscene ?? process.env.RENPY_AGENT_CUTSCENE === '1';
  let runningHubClient: RunningHubClient | undefined;
  if (enableAudioUi || enableCutscene) {
    const rhKey = process.env.RUNNINGHUB_API_KEY;
    if (!rhKey) {
      const flag = enableAudioUi ? '--audio-ui' : '--cutscene';
      console.error(
        `Error: ${flag} requires RUNNINGHUB_API_KEY to be set in the environment.`,
      );
      return 1;
    }
    runningHubClient = new HttpRunningHubClient({
      apiKey: rhKey,
      appSchemas: RUNNINGHUB_APP_SCHEMAS,
    });
  }

  try {
    const result = await runPipeline({
      inspiration: cmd.inspiration,
      storyName,
      llm,
      enableAudioUi,
      enableCutscene,
      ...(cmd.resume ? { resume: true } : {}),
      ...(runningHubClient !== undefined ? { runningHubClient } : {}),
    });
    console.log(`\n✅ Done. Game at: ${result.gamePath}`);
    console.log(`   Run:  renpy-sdk/renpy.exe "${result.gamePath}"`);
    if (result.audioUi) {
      const s = result.audioUi;
      console.log(
        `   audio-ui: bgm ${s.bgm.ok}/${s.bgm.ok + s.bgm.err}, ` +
          `voice ${s.voice.ok}/${s.voice.ok + s.voice.err}, ` +
          `sfx ${s.sfx.ok}/${s.sfx.ok + s.sfx.err}, ` +
          `ui ${s.ui.ok}/${s.ui.ok + s.ui.err}`,
      );
    }
    if (result.cutscene) {
      const c = result.cutscene;
      console.log(
        `   cutscene: ok ${c.ok}, err ${c.err}, skipped ${c.skipped}`,
      );
    }
    return result.testRun.result === 'fail' ? 2 : 0;
  } catch (err) {
    console.error(`\n❌ Pipeline failed: ${String((err as Error).message)}`);
    return 1;
  }
}

async function runModify(cmd: ModifyCommand): Promise<number> {
  const gameDir = gameDirFor(cmd.storyName);
  try {
    switch (cmd.op) {
      case 'character':
        await modifyCharacterAppearance({
          gameDir,
          characterName: cmd.characterName,
          newVisualDescription: cmd.visualDescription,
        });
        break;
      case 'dialogue':
        await modifyDialogueLine({
          gameDir,
          shotNumber: cmd.shotNumber,
          lineIndex: cmd.lineIndex,
          newText: cmd.text,
        });
        break;
      case 'shots':
        await reorderShots({ gameDir, newOrder: cmd.order });
        break;
    }
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? storyNotFoundMessage(cmd.storyName)
      : String((err as Error).message);
    console.error(`❌ modify failed: ${message}`);
    return 1;
  }
  console.log(`✅ Modified ${cmd.op} in "${cmd.storyName}"`);

  if (!cmd.rebuild) {
    console.log(`   Run \`renpy-agent rebuild ${cmd.storyName}\` to regenerate script.rpy`);
    return 0;
  }

  try {
    const result = await rebuildGameProject({ storyName: cmd.storyName });
    console.log(`✅ Rebuilt. Game at: ${result.gamePath}`);
    return result.testRun.result === 'fail' ? 2 : 0;
  } catch (err) {
    console.error(
      `❌ Modified snapshot saved, but rebuild failed: ${String((err as Error).message)}\n` +
        `   Run \`renpy-agent rebuild ${cmd.storyName}\` to retry.`,
    );
    return 1;
  }
}

async function runRebuild(cmd: RebuildCommand): Promise<number> {
  try {
    const result = await rebuildGameProject({ storyName: cmd.storyName });
    console.log(`✅ Rebuilt. Game at: ${result.gamePath}`);
    return result.testRun.result === 'fail' ? 2 : 0;
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? storyNotFoundMessage(cmd.storyName)
      : String((err as Error).message);
    console.error(`❌ rebuild failed: ${message}`);
    return 1;
  }
}

function gameDirFor(storyName: string): string {
  return resolve(process.cwd(), 'runtime', 'games', storyName, 'game');
}

function storyNotFoundMessage(storyName: string): string {
  return `Story "${storyName}" not found. Did you run \`renpy-agent generate\` first?`;
}

// Only run when invoked directly (not when imported by tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
