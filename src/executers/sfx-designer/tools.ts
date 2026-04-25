import { stubTool, type PocToolSet } from '../../agents/tool-schema.js';

const sfxStub = stubTool('generate_sfx', 'Generate a shot-level SFX cue (Tier 2, v0.7).');

export const sfxDesignerTools: PocToolSet = {
  schemas: [sfxStub.schema],
  executors: { generate_sfx: sfxStub.executor },
};
