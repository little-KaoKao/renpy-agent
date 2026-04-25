import { stubTool, type PocToolSet } from '../../agents/tool-schema.js';

const bgmStub = stubTool(
  'generate_bgm_track',
  'Generate a chapter BGM track (Tier 2, v0.7).',
);

export const musicDirectorTools: PocToolSet = {
  schemas: [bgmStub.schema],
  executors: { generate_bgm_track: bgmStub.executor },
};
