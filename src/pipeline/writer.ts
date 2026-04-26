import type { LlmClient } from '../llm/types.js';
import { extractJsonBlock } from '../llm/claude-client.js';
import { retryJsonParse } from '../llm/retry.js';
import { wrapParseError } from '../llm/stage-parse-error.js';
import { repairCjkInnerQuotes } from '../llm/json-repair.js';
import type { PlannerOutput, WriterOutput } from './types.js';

const WRITER_SYSTEM = `You are the Writer for a Ren'Py galgame.
You are given the Planner's PlannerOutput (project title, characters, scenes, chapter outline).
Write a single-chapter script as structured dialogue. Keep it short enough to fit ~8 shots
(the Storyboarder will condense it). Use only characters that appear in PlannerOutput.characters
and locations that appear in PlannerOutput.scenes.

Return ONLY a JSON object inside a \`\`\`json fence, matching:
\`\`\`typescript
interface WriterOutput {
  scenes: Array<{
    location: string;                    // MUST match one of planner.scenes[].name
    characters: Array<string>;           // subset of planner.characters[].name
    lines: Array<{
      speaker: string;                   // character name, or "narrator" for inner monologue
      text: string;                      // one spoken line (no stage directions inside)
      emotion?: string;                  // optional, short (e.g. "sad", "hopeful")
      direction?: string;                // optional stage direction (e.g. "looks up")
    }>;
  }>;
}
\`\`\`
No prose outside the fence.

CRITICAL: If a line of dialogue needs quoted speech or thought inside it, use
Chinese full-width quotes 「」 or 『』, NOT raw ASCII double quotes. Raw inner
\`"\` breaks JSON parsing.
Bad:  "text": "他说"别走"。"
Good: "text": "他说「别走」。"`;

export interface RunWriterParams {
  readonly planner: PlannerOutput;
  readonly llm: LlmClient;
}

export async function runWriter(params: RunWriterParams): Promise<WriterOutput> {
  const userMsg = [
    'PLANNER OUTPUT:',
    '```json',
    JSON.stringify(params.planner, null, 2),
    '```',
    '',
    'Now write the chapter script as WriterOutput.',
  ].join('\n');

  return retryJsonParse({
    attempt: async () => {
      const res = await params.llm.chat({
        messages: [
          { role: 'system', content: WRITER_SYSTEM, cacheControl: { type: 'ephemeral' } },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.7,
        maxTokens: 4096,
      });
      try {
        const json = extractJsonBlock(res.content);
        const parsed = tryParseWithRepair<WriterOutput>(json);
        assertWriterOutput(parsed);
        return parsed;
      } catch (e) {
        throw wrapParseError(e, res.content);
      }
    },
    onRetry: (err, attempt) => {
      console.warn(`[writer] attempt ${attempt} produced invalid output (${err.message}); retrying...`);
    },
  });
}

function tryParseWithRepair<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (firstErr) {
    const repaired = repairCjkInnerQuotes(json);
    if (repaired !== json) {
      return JSON.parse(repaired) as T;
    }
    throw firstErr;
  }
}

function assertWriterOutput(value: unknown): asserts value is WriterOutput {
  if (!value || typeof value !== 'object') throw new Error('Writer output is not an object');
  const obj = value as { scenes?: unknown };
  if (!Array.isArray(obj.scenes) || obj.scenes.length === 0) {
    throw new Error('Writer output requires at least one scene');
  }
  for (const [i, s] of obj.scenes.entries()) {
    if (!s || typeof s !== 'object') throw new Error(`scene[${i}] is not an object`);
    const scene = s as Record<string, unknown>;
    if (typeof scene.location !== 'string') throw new Error(`scene[${i}].location must be string`);
    if (!Array.isArray(scene.lines) || scene.lines.length === 0) {
      throw new Error(`scene[${i}].lines must be a non-empty array`);
    }
  }
}
