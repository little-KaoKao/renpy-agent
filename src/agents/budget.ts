// V5 runtime budget cap. The smoke script and long runs pass a dollar cap
// into runV5; every LLM call's usage is accumulated into a shared tracker.
// When the next check exceeds the cap, we throw a structured error so the
// Planner loop can gracefully land a finish instead of blowing through wallet.
//
// Cost model: Sonnet 4.6 on-demand list price — $3 / Mtok input, $15 / Mtok
// output. We intentionally double-count cacheReadInputTokens (which would
// otherwise get a ~90% discount) to keep the cap conservative; overestimating
// is safe for a safety rail.

import type {
  LlmChatParams,
  LlmClient,
  LlmResponse,
  LlmToolChatParams,
  LlmToolChatResponse,
  LlmUsage,
} from '../llm/types.js';

/** Sonnet 4.6 on-demand list pricing. */
export const SONNET_46_USD_PER_MTOK_INPUT = 3;
export const SONNET_46_USD_PER_MTOK_OUTPUT = 15;

export class BudgetExceededError extends Error {
  readonly capUsd: number;
  readonly totalCostUsd: number;
  constructor(capUsd: number, totalCostUsd: number) {
    super(
      `Budget cap exceeded: cumulative $${totalCostUsd.toFixed(4)} > cap $${capUsd.toFixed(2)}`,
    );
    this.name = 'BudgetExceededError';
    this.capUsd = capUsd;
    this.totalCostUsd = totalCostUsd;
  }
}

export function estimateSonnet46CostUsd(usage: LlmUsage): number {
  // cacheReadInputTokens is deliberately ignored (so cache-read input still
  // counts at full price in the cap check). This is the "conservative"
  // estimate — for real accounting, the smoke report already tallies
  // cacheReadInputTokens separately.
  const inCost = (usage.inputTokens / 1_000_000) * SONNET_46_USD_PER_MTOK_INPUT;
  const outCost = (usage.outputTokens / 1_000_000) * SONNET_46_USD_PER_MTOK_OUTPUT;
  return inCost + outCost;
}

export class BudgetTracker {
  private readonly capUsd: number | undefined;
  private _totalCostUsd = 0;
  private _llmCalls = 0;

  constructor(capUsd: number | undefined) {
    this.capUsd = capUsd;
  }

  get totalCostUsd(): number {
    return this._totalCostUsd;
  }

  get llmCalls(): number {
    return this._llmCalls;
  }

  get budgetCapUsd(): number | undefined {
    return this.capUsd;
  }

  add(usage: LlmUsage): void {
    this._totalCostUsd += estimateSonnet46CostUsd(usage);
    this._llmCalls++;
  }

  /** Throws BudgetExceededError if cumulative cost has exceeded the cap. */
  checkCap(): void {
    if (this.capUsd === undefined) return;
    if (this._totalCostUsd > this.capUsd) {
      throw new BudgetExceededError(this.capUsd, this._totalCostUsd);
    }
  }
}

/**
 * Wraps an LlmClient so every chat/chatWithTools response is tallied into the
 * shared BudgetTracker. The wrapped call accumulates THEN checks — meaning the
 * call that pushes us over the cap returns its response normally and the
 * NEXT call is the one that throws. That's intentional: once we see the
 * overage we want to short-circuit further LLM traffic immediately.
 *
 * Note: we check BEFORE the call too, so if an earlier call already blew the
 * cap (e.g. across Planner/Executer instances sharing the tracker), the next
 * chat throws without spending more.
 */
export function wrapLlmClientWithBudget(
  inner: LlmClient,
  tracker: BudgetTracker,
): LlmClient {
  const wrapped: LlmClient = {
    async chat(params: LlmChatParams): Promise<LlmResponse> {
      tracker.checkCap();
      const res = await inner.chat(params);
      tracker.add(res.usage);
      tracker.checkCap();
      return res;
    },
  };
  if (inner.chatWithTools) {
    wrapped.chatWithTools = async (
      params: LlmToolChatParams,
    ): Promise<LlmToolChatResponse> => {
      tracker.checkCap();
      const res = await inner.chatWithTools!(params);
      tracker.add(res.usage);
      tracker.checkCap();
      return res;
    };
  }
  return wrapped;
}
