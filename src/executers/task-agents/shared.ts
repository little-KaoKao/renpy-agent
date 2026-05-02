// Shared helpers for the 3 concrete v0.7 task agents. Keeps the DRY_RUN switch
// and typed probes out of each individual agent file.

export function isDryRun(input: Record<string, unknown>): boolean {
  if (typeof input.DRY_RUN === 'boolean') return input.DRY_RUN;
  return process.env.RUNNINGHUB_DRY_RUN === '1';
}
