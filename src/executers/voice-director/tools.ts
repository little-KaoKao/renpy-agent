import { stubTool, type PocToolSet } from '../../agents/tool-schema.js';

const voiceStub = stubTool(
  'generate_voice_line',
  'Generate a voice line for a Script line (Tier 2, v0.7).',
);

export const voiceDirectorTools: PocToolSet = {
  schemas: [voiceStub.schema],
  executors: { generate_voice_line: voiceStub.executor },
};
