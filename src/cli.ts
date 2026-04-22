#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { ClaudeLlmClient } from './llm/claude-client.js';
import { runPipeline, slugifyStoryName } from './pipeline/run-pipeline.js';

export interface ParsedCliArgs {
  readonly inspiration: string;
  readonly storyName?: string;
  readonly help?: boolean;
}

export function parseArgs(argv: ReadonlyArray<string>): ParsedCliArgs {
  let storyName: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') return { inspiration: '', help: true };
    if (arg === '--name') {
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
  return { inspiration, storyName };
}

const HELP_TEXT = `Usage:
  renpy-agent [--name <slug>] <inspiration text>

Options:
  --name <slug>   Story folder name (defaults to "story-YYYYMMDD-HHMMSS")
  -h, --help      Show this help

Environment:
  ANTHROPIC_API_KEY  required (loaded from .env via "node --env-file=.env ...")
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

  try {
    const result = await runPipeline({
      inspiration: parsed.inspiration,
      storyName,
      llm,
    });
    console.log(`\n✅ Done. Game at: ${result.gamePath}`);
    console.log(`   Run:  renpy-sdk/renpy.exe "${result.gamePath}"`);
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
