// Helpers shared by every Tier 2 tool wrapper in src/executers/*/tools.ts:
// context probes (RunningHub client + registry path), slug helpers that match
// the v0.7 `slugForFilename` rules, and a standard guard for asserting the tool
// was invoked with the required plumbing. Keeps each tool.ts short.

import { resolve } from 'node:path';
import type { CommonToolContext } from '../../agents/common-tools.js';
import type { RunningHubClient } from './runninghub-client.js';
import type { FetchLike } from '../../assets/download.js';
import { slugForFilename } from '../../assets/download.js';

/** Resolve the registry file path used by swapAssetPlaceholder / markAssetError. */
export function registryPathFor(ctx: CommonToolContext): string {
  if (ctx.registryPath) return ctx.registryPath;
  return resolve(ctx.gameDir, '..', 'asset-registry.json');
}

export interface Tier2ClientBundle {
  readonly client: RunningHubClient;
  readonly registryPath: string;
  readonly fetchFn?: FetchLike;
}

/**
 * Assert the context carries the RunningHub wiring Tier 2 tools need. Returns
 * a discriminated union rather than throwing, so callers can surface a clean
 * `{error: ...}` tool_result to the LLM instead of crashing the Executer loop.
 */
export function requireTier2Client(
  ctx: CommonToolContext,
  toolName: string,
): { readonly ok: true; readonly bundle: Tier2ClientBundle } | { readonly ok: false; readonly error: string } {
  if (!ctx.runningHubClient) {
    return {
      ok: false,
      error: `${toolName}: ctx.runningHubClient not injected (run V5 with RUNNINGHUB_API_KEY set)`,
    };
  }
  const bundle: Tier2ClientBundle = {
    client: ctx.runningHubClient,
    registryPath: registryPathFor(ctx),
    ...(ctx.fetchFn !== undefined ? { fetchFn: ctx.fetchFn } : {}),
  };
  return { ok: true, bundle };
}

export { slugForFilename };
