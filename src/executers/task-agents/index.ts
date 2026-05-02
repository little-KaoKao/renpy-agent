// Barrel for the 3 concrete v0.7 task agents + a bootstrap helper that run-v5
// uses to pick real vs DRY_RUN registry based on env.

import type { TaskAgentFn, TaskAgentRegistry } from '../../agents/common-tools.js';
import { characterPromptExpander } from './prompt-expander.js';
import { characterMainImageGenerator } from './main-image-generator.js';
import { sceneBackgroundGenerator } from './scene-background-generator.js';

export {
  characterPromptExpander,
  characterMainImageGenerator,
  sceneBackgroundGenerator,
};

/**
 * Wrap a concrete task agent to force DRY_RUN mode regardless of the input.
 * Used when the process has no RUNNINGHUB_API_KEY — we still inject the agents
 * so the Executer can exercise the call_task_agent path, but every call goes
 * through the mock branch instead of hitting the wallet.
 */
export function forceDryRun(fn: TaskAgentFn): TaskAgentFn {
  return (input, ctx) => fn({ ...input, DRY_RUN: true }, ctx);
}

/**
 * Build the task-agent registry used by runV5. If `dryRun` is true every agent
 * is wrapped with `forceDryRun`. Otherwise the real agents are injected and
 * rely on each call's `DRY_RUN` hint (or `RUNNINGHUB_DRY_RUN=1` env) to switch
 * back to the mock branch.
 */
export function buildDefaultTaskAgents(dryRun: boolean): TaskAgentRegistry {
  const real: TaskAgentRegistry = {
    character_prompt_expander: characterPromptExpander,
    character_main_image_generator: characterMainImageGenerator,
    scene_background_generator: sceneBackgroundGenerator,
  };
  if (!dryRun) return real;
  return {
    character_prompt_expander: forceDryRun(characterPromptExpander),
    character_main_image_generator: forceDryRun(characterMainImageGenerator),
    scene_background_generator: forceDryRun(sceneBackgroundGenerator),
  };
}
