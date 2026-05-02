// character_prompt_expander — v0.7 concrete task agent.
//
// Input shape:
//   { characterUri?: string, visualDescription?: string, DRY_RUN?: boolean }
// Either `visualDescription` (freeform) OR `characterUri` (read workspace doc
// and pull its visualDescription) must be supplied. When both are present,
// visualDescription wins — the caller already decided what to expand.
//
// Output: { prompt: string, sourceUri?: string }. `prompt` is the MJ v7 friendly
// English expansion: ~120-180 tokens, plain text, comma-separated feature list.
//
// The LLM call is cheap (Sonnet 4.6, ~150 tok in / ~200 tok out = ≈$0.003). We
// keep the system message short and push structure with one example so the
// response stays a single JSON object the parser can pick up.

import type { TaskAgentFn } from '../../agents/common-tools.js';
import { readWorkspaceDoc } from '../../agents/workspace-io.js';
import { extractJsonBlock } from '../../llm/claude-client.js';
import { isDryRun } from './shared.js';

interface CharacterDocMin {
  readonly name?: string;
  readonly visualDescription?: string;
}

const SYSTEM_PROMPT = `You expand a short character visual description into a Midjourney v7 image prompt.

Constraints:
- Output English only, 100-180 tokens, comma-separated feature list.
- Lead with the subject, then hair, eyes, outfit, pose, mood, lighting, background.
- Keep style tags at the end: "anime, cel shaded, game character reference sheet, full body, neutral background".
- Do NOT include negative prompts, weights, or parameter flags (no --ar, no --v).
- Respond with ONLY a single JSON object of shape {"prompt": "..."}. No prose.`;

const DRY_RUN_PROMPT_TEMPLATE = (desc: string, name?: string) =>
  `[DRY_RUN] ${name ? `${name}: ` : ''}${desc.trim()}, anime, cel shaded, game character reference sheet, full body, neutral background`;

export const characterPromptExpander: TaskAgentFn = async (input, ctx) => {
  const characterUri = typeof input.characterUri === 'string' ? input.characterUri : null;
  const directDescription =
    typeof input.visualDescription === 'string' ? input.visualDescription : null;

  let visualDescription = directDescription;
  let characterName: string | undefined;
  if (!visualDescription && characterUri) {
    const doc = await readWorkspaceDoc<CharacterDocMin>(characterUri, ctx.gameDir);
    if (!doc) {
      return {
        error: `character_prompt_expander: character document not found at ${characterUri}`,
      };
    }
    visualDescription = doc.visualDescription ?? null;
    characterName = doc.name;
  }

  if (!visualDescription || visualDescription.trim().length === 0) {
    return {
      error:
        'character_prompt_expander: must provide non-empty visualDescription or a characterUri whose document has visualDescription set',
    };
  }

  if (isDryRun(input)) {
    const prompt = DRY_RUN_PROMPT_TEMPLATE(visualDescription, characterName);
    return {
      prompt,
      ...(characterUri ? { sourceUri: characterUri } : {}),
      dryRun: true,
    };
  }

  if (!ctx.llm) {
    return {
      error:
        'character_prompt_expander: ctx.llm is not available; Planner bootstrap must inject an LlmClient or pass DRY_RUN:true',
    };
  }

  const userContent = characterName
    ? `Character name: ${characterName}\nVisual description: ${visualDescription.trim()}`
    : `Visual description: ${visualDescription.trim()}`;

  const res = await ctx.llm.chat({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    maxTokens: 400,
    temperature: 0.4,
  });

  let prompt: string;
  try {
    const jsonText = extractJsonBlock(res.content);
    const parsed = JSON.parse(jsonText) as { prompt?: unknown };
    if (typeof parsed.prompt !== 'string' || parsed.prompt.trim().length === 0) {
      throw new Error('prompt field missing or empty');
    }
    prompt = parsed.prompt.trim();
  } catch (err) {
    ctx.logger.warn('character_prompt_expander.parse_fallback', {
      reason: (err as Error).message,
    });
    prompt = res.content.trim();
  }

  return {
    prompt,
    ...(characterUri ? { sourceUri: characterUri } : {}),
    usage: res.usage,
  };
};
