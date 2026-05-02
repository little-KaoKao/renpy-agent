import type { PocToolSet, ToolExecutor } from '../../agents/tool-schema.js';
import { buildWorkspaceIndex } from '../../agents/workspace-index.js';
import { writeWorkspaceDoc } from '../../agents/workspace-io.js';
import { runQa } from '../../pipeline/qa.js';

// Floor: even tiny workspaces must be cross-checked against 5 docs before
// lint is trusted, because lint can't catch cross-document drift.
const QA_MIN_READS_FLOOR = 5;

function computeMinRequiredReads(totalDocs: number): number {
  return Math.max(QA_MIN_READS_FLOOR, Math.ceil(totalDocs * 0.5));
}

const run_qa: ToolExecutor = async (_args, ctx) => {
  const index = await buildWorkspaceIndex(ctx.gameDir);
  const totalDocs = index.entries.length;
  const minRequiredReads = computeMinRequiredReads(totalDocs);
  const actualReads = ctx.readFromUriCount?.() ?? 0;

  if (actualReads < minRequiredReads) {
    ctx.logger.warn('qa.run_qa.read_quota_rejected', {
      totalDocs,
      minRequiredReads,
      actualReads,
    });
    return {
      error:
        `insufficient reads: read ${actualReads} of ${totalDocs} workspace docs before run_qa; ` +
        `at least ${minRequiredReads} required`,
      retry: false,
      guidance:
        `read at least ${minRequiredReads} docs via read_from_uri before running QA lint — ` +
        'lint only catches syntax; cross-document consistency (character names in storyboard ' +
        'vs character docs, scene references, script line indices) must be checked by reading.',
      totalDocs,
      minRequiredReads,
      actualReads,
    };
  }

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
