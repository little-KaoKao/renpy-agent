import type { LlmClient, LlmToolUseBlock } from '../llm/types.js';
import { retryOnStageValidationError } from '../llm/retry.js';
import { wrapParseError } from '../llm/stage-parse-error.js';
import type { PlannerOutput, WriterOutput } from './types.js';

const WRITER_SYSTEM = `You are the Writer for a Ren'Py galgame.
You are given the Planner's PlannerOutput (project title, characters, scenes, chapter outline).
Write a single-chapter script as structured dialogue. Keep it short enough to fit ~8 shots
(the Storyboarder will condense it). Use only characters that appear in PlannerOutput.characters
and locations that appear in PlannerOutput.scenes.

Call the tool \`emit_writer_output\` exactly once with the structured WriterOutput.
Do NOT emit prose — only the tool call.`;

const WRITER_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'MUST match one of planner.scenes[].name',
          },
          characters: {
            type: 'array',
            items: { type: 'string' },
            description: 'subset of planner.characters[].name',
          },
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                speaker: {
                  type: 'string',
                  description: 'character name, or "narrator" for inner monologue',
                },
                text: {
                  type: 'string',
                  description: 'one spoken line (no stage directions inside)',
                },
                emotion: { type: 'string', description: 'short, e.g. "sad", "hopeful"' },
                direction: {
                  type: 'string',
                  description: 'optional stage direction (e.g. "looks up")',
                },
              },
              required: ['speaker', 'text'],
            },
          },
        },
        required: ['location', 'characters', 'lines'],
      },
    },
  },
  required: ['scenes'],
} as const;

export interface RunWriterParams {
  readonly planner: PlannerOutput;
  readonly llm: LlmClient;
}

export async function runWriter(params: RunWriterParams): Promise<WriterOutput> {
  if (!params.llm.chatWithTools) {
    throw new Error('runWriter requires an LlmClient that supports chatWithTools.');
  }

  const userMsg = [
    'PLANNER OUTPUT:',
    '```json',
    JSON.stringify(params.planner, null, 2),
    '```',
    '',
    'Now emit the chapter script by calling emit_writer_output with the structured WriterOutput.',
  ].join('\n');

  return retryOnStageValidationError({
    attempt: async () => {
      const res = await params.llm.chatWithTools!({
        messages: [
          { role: 'system', content: WRITER_SYSTEM },
          { role: 'user', content: userMsg },
        ],
        tools: [
          {
            name: 'emit_writer_output',
            description: 'Emit the WriterOutput as a single structured tool call.',
            inputSchema: WRITER_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
          },
        ],
        temperature: 0.7,
        maxTokens: 4096,
      });
      try {
        const parsed = extractToolInput(res.content, 'emit_writer_output');
        assertWriterOutput(parsed);
        return parsed;
      } catch (e) {
        throw wrapParseError(e, JSON.stringify(res.content));
      }
    },
    onRetry: (err, attempt) => {
      console.warn(
        `[writer] attempt ${attempt} produced invalid output (${err.message}); retrying...`,
      );
    },
  });
}

function extractToolInput(
  content: ReadonlyArray<{ type: string }>,
  toolName: string,
): unknown {
  const toolUse = content.find(
    (b): b is LlmToolUseBlock => b.type === 'tool_use' && (b as LlmToolUseBlock).name === toolName,
  );
  if (!toolUse) {
    throw new Error(`LLM did not call tool ${toolName}`);
  }
  return toolUse.input;
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
