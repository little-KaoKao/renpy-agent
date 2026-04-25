import { stubTool, type PocToolSet } from '../../agents/tool-schema.js';

const uiStub = stubTool(
  'generate_ui_patch',
  'Generate a Ren\'Py screens.rpy mood patch (Tier 2, v0.7).',
);

export const uiDesignerTools: PocToolSet = {
  schemas: [uiStub.schema],
  executors: { generate_ui_patch: uiStub.executor },
};
