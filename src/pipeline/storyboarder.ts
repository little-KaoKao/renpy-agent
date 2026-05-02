import type { LlmClient, LlmToolUseBlock } from '../llm/types.js';
import { retryOnStageValidationError } from '../llm/retry.js';
import { wrapParseError } from '../llm/stage-parse-error.js';
import {
  SHOT_EFFECTS,
  SHOT_STAGING,
  SHOT_TRANSFORMS,
  SHOT_TRANSITIONS,
  type PlannerOutput,
  type StoryboarderOutput,
  type WriterOutput,
} from './types.js';
import { normalizeStoryboarderOutput } from './shot-enum.js';

const STORYBOARDER_SYSTEM = `You are the Storyboarder for a Ren'Py galgame Stage-A playable demo.
You condense the Writer's script into AT MOST 8 shots. For each shot you describe the staging
in Ren'Py-flavored terms (the Coder will translate into actual .rpy).

Reference patterns from baiying-demo (the Stage-A fixture we're modeling after):
- Each shot typically uses ONE location (from planner.scenes[].name) and 0-2 characters.
- The Coder dispatches on enum values only; free prose in these fields is IGNORED.

**Enum fields** — choose ONE (or array for effects) per shot:

- \`transform\` (camera / character motion, one of):
  - stand        — gentle breathing idle (baseline for a standing character)
  - lookup       — character tilts head up
  - front        — pull camera forward, medium close
  - finger       — tight zoom to face / pointing gesture
  - forehead     — extreme close-up on forehead
  - heart_pulse  — whole-layer rhythmic zoom (emotional beat)
  - reset        — release any in-flight layer transform
  - pan_left     — camera pans to screen-left
  - pan_right    — camera pans to screen-right
  - fade_in      — sprite fades into view from transparent
  - fade_out     — sprite fades out to transparent
  - shake        — quick horizontal shake (impact / shock)
  - blink        — two-beat alpha blink (tension / time skip)

- \`staging\` (character placement on stage, one of):
  - solo_center | solo_left | solo_right | two_shot | group | none

- \`transition\` (between shots, one of): fade | dissolve | none

- \`effects\` (particle overlays, ARRAY — use [] for none):
  - sakura | snow | rain | lensflare | none

Cutscene (video) path — ONLY use when the beat genuinely demands motion that static
sprites + transforms cannot sell:
- opening/closing/chapter transition → cutscene.kind = "transition",
  referenceSceneName only (no character parameter).
- pivotal plot CG (kiss / fight / death / big reveal) → cutscene.kind = "reference",
  referenceSceneName + referenceCharacterName (ONE hero character).
- Omit the cutscene field entirely for normal dialogue shots. Do NOT mark more than 2
  cutscene shots per 8-shot board — videos are expensive and slow.
- When cutscene is set, sceneName / characters / staging / transform still fill in for
  Stage A placeholder rendering (the Coder shows a black screen + caption until the real
  video is ready).

Shots must be non-empty, contiguously numbered starting at 1, and <= 8 total.

Call the tool \`emit_storyboarder_output\` exactly once with the structured shots. No prose.`;

const STORYBOARDER_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          shotNumber: { type: 'integer', minimum: 1, description: '1-indexed, contiguous' },
          description: {
            type: 'string',
            description: "one sentence describing the shot's intent",
          },
          characters: {
            type: 'array',
            items: { type: 'string' },
            description: 'subset of planner.characters[].name',
          },
          sceneName: {
            type: 'string',
            description: 'one of planner.scenes[].name',
          },
          staging: {
            type: 'string',
            enum: [...SHOT_STAGING],
            description: 'character placement enum (see system prompt)',
          },
          transform: {
            type: 'string',
            enum: [...SHOT_TRANSFORMS],
            description: 'camera / motion enum (see system prompt)',
          },
          transition: {
            type: 'string',
            enum: [...SHOT_TRANSITIONS],
          },
          effects: {
            type: 'array',
            items: { type: 'string', enum: [...SHOT_EFFECTS] },
            description: 'particle overlay enums — use [] for none',
          },
          cutscene: {
            type: 'object',
            description: 'Only present when the shot genuinely needs a motion video beat.',
            properties: {
              kind: { type: 'string', enum: ['transition', 'reference'] },
              motionPrompt: { type: 'string' },
              referenceSceneName: { type: 'string' },
              referenceCharacterName: { type: 'string' },
            },
            required: ['kind', 'motionPrompt'],
          },
          dialogueLines: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                speaker: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['speaker', 'text'],
            },
          },
        },
        required: [
          'shotNumber',
          'description',
          'characters',
          'sceneName',
          'staging',
          'transform',
          'transition',
          'effects',
          'dialogueLines',
        ],
      },
    },
  },
  required: ['shots'],
} as const;

export interface RunStoryboarderParams {
  readonly planner: PlannerOutput;
  readonly writer: WriterOutput;
  readonly llm: LlmClient;
}

export async function runStoryboarder(
  params: RunStoryboarderParams,
): Promise<StoryboarderOutput> {
  if (!params.llm.chatWithTools) {
    throw new Error('runStoryboarder requires an LlmClient that supports chatWithTools.');
  }

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
    'Now emit the storyboard (<= 8 shots) by calling emit_storyboarder_output.',
  ].join('\n');

  return retryOnStageValidationError({
    attempt: async () => {
      const res = await params.llm.chatWithTools!({
        messages: [
          { role: 'system', content: STORYBOARDER_SYSTEM, cacheControl: { type: 'ephemeral' } },
          { role: 'user', content: userMsg },
        ],
        tools: [
          {
            name: 'emit_storyboarder_output',
            description: 'Emit the StoryboarderOutput as a single structured tool call.',
            inputSchema: STORYBOARDER_TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
          },
        ],
        temperature: 0.6,
        maxTokens: 6000,
      });
      try {
        const parsed = extractToolInput(res.content, 'emit_storyboarder_output');
        assertStoryboarderOutput(parsed);
        // Normalize so v0.7 enum shape is always what downstream sees, even if
        // the LLM ignored `enum` and emitted legacy prose.
        return normalizeStoryboarderOutput(parsed);
      } catch (e) {
        throw wrapParseError(e, JSON.stringify(res.content));
      }
    },
    onRetry: (err, attempt) => {
      console.warn(
        `[storyboarder] attempt ${attempt} produced invalid output (${err.message}); retrying...`,
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
