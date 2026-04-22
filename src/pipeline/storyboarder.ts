import type { LlmClient } from '../llm/types.js';
import { extractJsonBlock } from '../llm/claude-client.js';
import type { PlannerOutput, StoryboarderOutput, WriterOutput } from './types.js';

const STORYBOARDER_SYSTEM = `You are the Storyboarder for a Ren'Py galgame Stage-A playable demo.
You condense the Writer's script into AT MOST 8 shots. For each shot you describe the staging
in Ren'Py-flavored terms (the Coder will translate into actual .rpy).

Reference patterns from baiying-demo (the Stage-A fixture we're modeling after):
- Each shot typically uses ONE location (from planner.scenes[].name) and 0-2 characters.
- "staging" uses verbs like "enter", "lookup", "front", "finger", "forehead",
  "hide_sakura", "show_particles", "text_input".
- "transforms" describes camera / character motion: "stand breathing", "lean in",
  "pull back", "heart_pulse", "reset".
- "transition": one of "fade", "dissolve", "none".
- "effects": optional, e.g. "sakura particles", "text shader jitter".
- The final shot should include a closing beat.

Return ONLY a JSON object inside a \`\`\`json fence, matching:
\`\`\`typescript
interface StoryboarderOutput {
  shots: Array<{
    shotNumber: number;          // 1-indexed, contiguous
    description: string;         // one sentence describing the shot's intent
    characters: Array<string>;   // subset of planner.characters[].name
    sceneName: string;           // one of planner.scenes[].name
    staging: string;             // short phrase, see verbs above
    transforms: string;          // short phrase, see verbs above
    transition: string;          // fade | dissolve | none
    effects?: string;            // optional short phrase
    dialogueLines: Array<{       // 1-6 lines per shot
      speaker: string;           // character name, or "narrator"
      text: string;
    }>;
  }>;
}
\`\`\`
Shots must be non-empty, contiguously numbered starting at 1, and <= 8 total.
No prose outside the fence.`;

export interface RunStoryboarderParams {
  readonly planner: PlannerOutput;
  readonly writer: WriterOutput;
  readonly llm: LlmClient;
}

export async function runStoryboarder(
  params: RunStoryboarderParams,
): Promise<StoryboarderOutput> {
  const userMsg = [
    'PLANNER OUTPUT:',
    '```json',
    JSON.stringify(params.planner, null, 2),
    '```',
    '',
    'WRITER OUTPUT:',
    '```json',
    JSON.stringify(params.writer, null, 2),
    '```',
    '',
    'Now produce StoryboarderOutput with at most 8 shots.',
  ].join('\n');

  const res = await params.llm.chat({
    messages: [
      { role: 'system', content: STORYBOARDER_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    temperature: 0.6,
    maxTokens: 6000,
  });

  const json = extractJsonBlock(res.content);
  const parsed = JSON.parse(json) as StoryboarderOutput;
  assertStoryboarderOutput(parsed);
  return parsed;
}

function assertStoryboarderOutput(
  value: unknown,
): asserts value is StoryboarderOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Storyboarder output is not an object');
  }
  const obj = value as { shots?: unknown };
  if (!Array.isArray(obj.shots) || obj.shots.length === 0) {
    throw new Error('Storyboarder output requires at least one shot');
  }
  if (obj.shots.length > 8) {
    throw new Error(`Storyboarder output has ${obj.shots.length} shots, max is 8`);
  }
  for (const [i, shot] of obj.shots.entries()) {
    if (!shot || typeof shot !== 'object') throw new Error(`shot[${i}] is not an object`);
    const s = shot as Record<string, unknown>;
    if (s.shotNumber !== i + 1) {
      throw new Error(`shot[${i}].shotNumber must be ${i + 1}, got ${String(s.shotNumber)}`);
    }
    if (typeof s.sceneName !== 'string') throw new Error(`shot[${i}].sceneName must be string`);
    if (!Array.isArray(s.dialogueLines) || s.dialogueLines.length === 0) {
      throw new Error(`shot[${i}].dialogueLines must be non-empty`);
    }
  }
}
