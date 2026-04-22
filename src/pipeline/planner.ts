import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { LlmClient } from '../llm/types.js';
import { extractJsonBlock } from '../llm/claude-client.js';
import type { PlannerOutput } from './types.js';

const PLANNER_SYSTEM_TEMPLATE = `You are the Planner for a galgame production pipeline.
You are given a user-supplied INSPIRATION (a sentence, paragraph, or outline).
Read the TypeScript schema below and produce a PlannerOutput JSON object that will seed
a single-chapter Stage-A playable demo (up to ~8 shots).

SCHEMA (galgame-workspace.ts):
\`\`\`typescript
{{SCHEMA}}
\`\`\`

Return ONLY a JSON object inside a \`\`\`json fence, matching this TypeScript shape:
\`\`\`typescript
interface PlannerOutput {
  projectTitle: string;      // A short title (<= 20 chars)
  genre: string;              // e.g. "romance", "mystery"
  tone: string;               // e.g. "tender", "melancholic"
  characters: Array<{         // 1-3 characters max for a Stage-A demo
    name: string;
    description: string;      // personality / role in one sentence
    visualDescription: string;// hair, eye color, outfit, ~2 sentences
  }>;
  scenes: Array<{             // 1-3 locations
    name: string;             // e.g. "sakura_night"
    description: string;      // what the place looks/feels like
  }>;
  chapterOutline: string;     // one paragraph describing the single chapter's arc
}
\`\`\`
No prose outside the fence.`;

let cachedSchema: string | null = null;

async function loadSchema(): Promise<string> {
  if (cachedSchema !== null) return cachedSchema;
  const here = dirname(fileURLToPath(import.meta.url));
  // When running from source (src/pipeline/planner.ts), this resolves to
  // src/schema/galgame-workspace.ts. When running from dist/pipeline/planner.js,
  // copy-templates.mjs mirrors the schema to dist/schema/galgame-workspace.ts.
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

  const res = await params.llm.chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `INSPIRATION:\n${params.inspiration}` },
    ],
    temperature: 0.7,
    maxTokens: 4096,
  });

  const json = extractJsonBlock(res.content);
  const parsed = JSON.parse(json) as PlannerOutput;
  assertPlannerOutput(parsed);
  return parsed;
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
