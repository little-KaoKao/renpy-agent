import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { LlmClient, LlmToolUseBlock } from '../llm/types.js';
import { retryOnStageValidationError } from '../llm/retry.js';
import { wrapParseError } from '../llm/stage-parse-error.js';
import type { PlannerOutput } from './types.js';

const PLANNER_SYSTEM_TEMPLATE = `You are the Planner for a galgame production pipeline.
You are given a user-supplied INSPIRATION (a sentence, paragraph, or outline).
Read the TypeScript schema below and decide the PlannerOutput that will seed a
single-chapter Stage-A playable demo (up to ~8 shots).

SCHEMA (galgame-workspace.ts):
\`\`\`typescript
{{SCHEMA}}
\`\`\`

Call the tool \`emit_planner_output\` exactly once with a structured PlannerOutput.
Do NOT emit prose, do NOT emit JSON text — only the tool call.`;

const PLANNER_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    projectTitle: { type: 'string', description: 'Short title, <= 20 chars' },
    genre: { type: 'string', description: 'e.g. romance, mystery' },
    tone: { type: 'string', description: 'e.g. tender, melancholic' },
    characters: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      description: '1-3 characters for a Stage-A demo',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'personality / role in one sentence' },
          visualDescription: {
            type: 'string',
            description: 'hair, eye color, outfit, ~2 sentences',
          },
        },
        required: ['name', 'description', 'visualDescription'],
      },
    },
    scenes: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      description: '1-3 locations',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'e.g. sakura_night' },
          description: { type: 'string', description: 'what the place looks/feels like' },
        },
        required: ['name', 'description'],
      },
    },
    chapterOutline: {
      type: 'string',
      description: "one paragraph describing the single chapter's arc",
    },
  },
  required: ['projectTitle', 'genre', 'tone', 'characters', 'scenes', 'chapterOutline'],
} as const;

let cachedSchema: string | null = null;

async function loadSchema(): Promise<string> {
  if (cachedSchema !== null) return cachedSchema;
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(here, '../schema/galgame-workspace.ts');
  cachedSchema = await readFile(schemaPath, 'utf8');
  return cachedSchema;
}

export interface RunPlannerParams {
  readonly inspiration: string;
  readonly llm: LlmClient;
}

export async function runPlanner(params: RunPlannerParams): Promise<PlannerOutput> {
  const schema = await loadSchema();
  const system = PLANNER_SYSTEM_TEMPLATE.replace('{{SCHEMA}}', schema);
  if (!params.llm.chatWithTools) {
    throw new Error('runPlanner requires an LlmClient that supports chatWithTools.');
  }

  return retryOnStageValidationError({
    attempt: async () => {
      const res = await params.llm.chatWithTools!({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `INSPIRATION:\n${params.inspiration}` },
        ],
        tools: [
          {
            name: 'emit_planner_output',
            description:
              'Emit the PlannerOutput as a single structured tool call. ' +
              'All fields are required.',
            inputSchema: PLANNER_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
          },
        ],
        temperature: 0.7,
        maxTokens: 4096,
      });

      try {
        const parsed = extractToolInput(res.content, 'emit_planner_output');
        assertPlannerOutput(parsed);
        return parsed;
      } catch (e) {
        throw wrapParseError(e, describeContent(res.content));
      }
    },
    onRetry: (err, attempt) => {
      console.warn(
        `[planner] attempt ${attempt} produced invalid output (${err.message}); retrying...`,
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

function describeContent(content: ReadonlyArray<{ type: string }>): string {
  return JSON.stringify(content);
}

function assertPlannerOutput(value: unknown): asserts value is PlannerOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Planner output is not an object');
  }
  const obj = value as Record<string, unknown>;
  for (const key of ['projectTitle', 'genre', 'tone', 'chapterOutline']) {
    if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
      throw new Error(`Planner output missing required string field: ${key}`);
    }
  }
  if (!Array.isArray(obj.characters) || obj.characters.length === 0) {
    throw new Error('Planner output requires at least one character');
  }
  if (!Array.isArray(obj.scenes) || obj.scenes.length === 0) {
    throw new Error('Planner output requires at least one scene');
  }
}
