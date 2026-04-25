// Binds PocRole -> PocToolSet. The Executer loop consults this when a handoff
// happens to figure out which schemas + executors to load into the current
// conversation.

import type { PocRole } from './poc-registry.js';
import type { PocToolSet } from './tool-schema.js';
import { producerTools } from '../executers/producer/tools.js';
import { writerTools } from '../executers/writer/tools.js';
import { storyboarderTools } from '../executers/storyboarder/tools.js';
import { characterDesignerTools } from '../executers/character-designer/tools.js';
import { sceneDesignerTools } from '../executers/scene-designer/tools.js';
import { coderTools } from '../executers/coder/tools.js';
import { qaTools } from '../executers/qa/tools.js';
import { musicDirectorTools } from '../executers/music-director/tools.js';
import { voiceDirectorTools } from '../executers/voice-director/tools.js';
import { sfxDesignerTools } from '../executers/sfx-designer/tools.js';
import { uiDesignerTools } from '../executers/ui-designer/tools.js';

export const TOOL_SET_BY_ROLE: Readonly<Record<PocRole, PocToolSet>> = {
  producer: producerTools,
  writer: writerTools,
  storyboarder: storyboarderTools,
  character_designer: characterDesignerTools,
  scene_designer: sceneDesignerTools,
  coder: coderTools,
  qa: qaTools,
  music_director: musicDirectorTools,
  voice_director: voiceDirectorTools,
  sfx_designer: sfxDesignerTools,
  ui_designer: uiDesignerTools,
};

export function getToolSetForRole(role: PocRole): PocToolSet {
  const set = TOOL_SET_BY_ROLE[role];
  if (!set) throw new Error(`no tool-set bound for role: ${role}`);
  return set;
}
