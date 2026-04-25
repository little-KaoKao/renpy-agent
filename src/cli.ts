#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { ClaudeLlmClient } from './llm/claude-client.js';
import {
  HttpRunningHubClient,
  type RunningHubClient,
} from './executers/common/runninghub-client.js';
import { RUNNINGHUB_APP_SCHEMAS } from './executers/common/runninghub-schemas.js';
import { runPipeline, slugifyStoryName } from './pipeline/run-pipeline.js';

export interface ParsedCliArgs {
  readonly inspiration: string;
  readonly storyName?: string;
  readonly help?: boolean;
  readonly audioUi?: boolean;
}

export function parseArgs(argv: ReadonlyArray<string>): ParsedCliArgs {
  let storyName: string | undefined;
  let audioUi = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') return { inspiration: '', help: true };
    if (arg === '--audio-ui') {
      audioUi = true;
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
  const result: ParsedCliArgs = { inspiration };
  if (storyName !== undefined) (result as { storyName?: string }).storyName = storyName;
  if (audioUi) (result as { audioUi?: boolean }).audioUi = true;
  return result;
}

const HELP_TEXT = `Usage:
  renpy-agent [--name <slug>] [--audio-ui] <inspiration text>

Options:
  --name <slug>   Story folder name (defaults to "story-YYYYMMDD-HHMMSS")
  --audio-ui      Enable v0.5 audio + UI stage (BGM / voice / SFX / main_menu patch).
                  Requires RUNNINGHUB_API_KEY in the environment.
                  Equivalent env flag: RENPY_AGENT_AUDIO_UI=1 (CLI flag wins).
  -h, --help      Show this help

Environment:
  ANTHROPIC_API_KEY    required (loaded from .env via "node --env-file=.env ...")
  RUNNINGHUB_API_KEY   required when --audio-ui is enabled
`;

export async function main(argv: ReadonlyArray<string>): Promise<number> {
  let parsed: ParsedCliArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(String((err as Error).message));
    console.error(HELP_TEXT);
    return 1;
  }
  if (parsed.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (!parsed.inspiration) {
    console.error('Error: inspiration text is required.');
    console.error(HELP_TEXT);
    return 1;
  }

  const storyName = slugifyStoryName(parsed.storyName);
  const llm = new ClaudeLlmClient();

  const enableAudioUi = parsed.audioUi ?? process.env.RENPY_AGENT_AUDIO_UI === '1';
  let runningHubClient: RunningHubClient | undefined;
  if (enableAudioUi) {
    const rhKey = process.env.RUNNINGHUB_API_KEY;
    if (!rhKey) {
      console.error(
        'Error: --audio-ui requires RUNNINGHUB_API_KEY to be set in the environment.',
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
      inspiration: parsed.inspiration,
      storyName,
      llm,
      enableAudioUi,
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
    return result.testRun.result === 'fail' ? 2 : 0;
  } catch (err) {
    console.error(`\n❌ Pipeline failed: ${String((err as Error).message)}`);
    return 1;
  }
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
