import { stubTool, type PocToolSet, type ToolExecutor } from '../../agents/tool-schema.js';
import { runQa } from '../../pipeline/qa.js';

const run_qa: ToolExecutor = async (_args, ctx) => {
  const result = await runQa({ gamePath: ctx.gameDir });
  ctx.logger.info('qa.run_qa', { result: result.result });
  return {
    result: result.result,
    syntaxErrors: result.syntaxErrors,
    runtimeErrors: result.runtimeErrors,
    warningMessage: result.warningMessage ?? null,
  };
};

const kickBackStub = stubTool(
  'kick_back_to_coder',
  'Kick a QA failure back to the coder (Tier 2, v0.7).',
);

export const qaTools: PocToolSet = {
  schemas: [
    {
      name: 'run_qa',
      description: 'Run Ren\'Py lint against the assembled game project and return pass/fail.',
      inputSchema: { type: 'object', properties: {} },
    },
    kickBackStub.schema,
  ],
  executors: {
    run_qa,
    kick_back_to_coder: kickBackStub.executor,
  },
};
