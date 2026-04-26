import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';
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

interface BugReportDoc {
  readonly uri: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly description: string;
  readonly shotNumber?: number;
  readonly stepsToReproduce: ReadonlyArray<string>;
  readonly createdAt: string;
}

const ALLOWED_SEVERITY = new Set<BugReportDoc['severity']>(['critical', 'high', 'medium', 'low']);

const kick_back_to_coder: ToolExecutor = async (args, ctx) => {
  const severityRaw = typeof args.severity === 'string' ? args.severity : 'medium';
  const description = typeof args.description === 'string' ? args.description : null;
  const shotNumber = typeof args.shotNumber === 'number' ? args.shotNumber : null;
  const steps = Array.isArray(args.stepsToReproduce)
    ? (args.stepsToReproduce.filter((s) => typeof s === 'string') as string[])
    : [];

  if (!description) return { error: 'kick_back_to_coder: description required' };
  if (!ALLOWED_SEVERITY.has(severityRaw as BugReportDoc['severity'])) {
    return { error: 'kick_back_to_coder: severity must be one of critical|high|medium|low' };
  }

  const id = `qa_${Date.now().toString(36)}`;
  const targetUri = `workspace://bugReport/${id}`;
  const doc: BugReportDoc = {
    uri: targetUri,
    severity: severityRaw as BugReportDoc['severity'],
    description,
    ...(shotNumber !== null ? { shotNumber } : {}),
    stepsToReproduce: steps,
    createdAt: new Date().toISOString(),
  };
  await writeWorkspaceDoc(targetUri, ctx.gameDir, doc);
  ctx.logger.warn('qa.kick_back_to_coder', { uri: targetUri, severity: doc.severity });
  return {
    uri: targetUri,
    severity: doc.severity,
    status: 'filed',
    message: 'BugReport filed; Planner should read this URI and re-handoff to coder.',
  };
};

export const qaTools: PocToolSet = {
  schemas: [
    {
      name: 'run_qa',
      description: "Run Ren'Py lint against the assembled game project and return pass/fail.",
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'kick_back_to_coder',
      description:
        'File a QA failure as a BugReport document under workspace://bugReport/<id>. ' +
        'Use this when run_qa fails — do NOT re-handoff; return to Planner with a finish summary ' +
        'pointing at the BugReport URI so the Planner can decide to re-handoff to coder.',
      inputSchema: {
        type: 'object',
        properties: {
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
          },
          description: {
            type: 'string',
            description: 'What is broken (1-2 sentences).',
          },
          shotNumber: {
            type: 'number',
            description: 'Optional shot this bug is tied to.',
          },
          stepsToReproduce: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['severity', 'description'],
      },
    },
  ],
  executors: {
    run_qa,
    kick_back_to_coder,
  },
};
