import { describe, expect, it, vi } from 'vitest';
import {
  BudgetExceededError,
  BudgetTracker,
  estimateSonnet46CostUsd,
  wrapLlmClientWithBudget,
} from './budget.js';
import type { LlmClient, LlmToolChatResponse, LlmResponse } from '../llm/types.js';

describe('estimateSonnet46CostUsd', () => {
  it('prices 1M input + 1M output at $18 (Sonnet 4.6 list)', () => {
    expect(
      estimateSonnet46CostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(18, 6);
  });

  it('ignores cacheReadInputTokens (keeps estimate conservative)', () => {
    // We deliberately double-count cache-read tokens — the budget cap is a
    // safety rail, not an accounting ledger. Overestimating is fine.
    const withCache = estimateSonnet46CostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 500_000,
    });
    const withoutCache = estimateSonnet46CostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(withCache).toBeCloseTo(withoutCache, 6);
  });
});

describe('BudgetTracker', () => {
  it('accumulates usage and reports totalCostUsd', () => {
    const tracker = new BudgetTracker(10);
    tracker.add({ inputTokens: 500_000, outputTokens: 100 });
    // 500k * $3/Mtok + 100 * $15/Mtok = $1.5 + $0.0015 ≈ $1.5015
    expect(tracker.totalCostUsd).toBeCloseTo(1.5015, 4);
  });

  it('throws BudgetExceededError when cumulative cost exceeds cap', () => {
    const tracker = new BudgetTracker(3);
    tracker.add({ inputTokens: 500_000, outputTokens: 100 }); // ~$1.5015 cum
    expect(() => tracker.checkCap()).not.toThrow();
    tracker.add({ inputTokens: 500_000, outputTokens: 100 }); // ~$3.003 cum
    expect(() => tracker.checkCap()).toThrow(BudgetExceededError);
  });

  it('BudgetExceededError carries capUsd and totalCostUsd', () => {
    const tracker = new BudgetTracker(1);
    tracker.add({ inputTokens: 1_000_000, outputTokens: 0 }); // $3
    try {
      tracker.checkCap();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      const err = e as BudgetExceededError;
      expect(err.name).toBe('BudgetExceededError');
      expect(err.capUsd).toBe(1);
      expect(err.totalCostUsd).toBeCloseTo(3, 4);
    }
  });

  it('no cap when budgetCapUsd is undefined', () => {
    const tracker = new BudgetTracker(undefined);
    tracker.add({ inputTokens: 10_000_000, outputTokens: 10_000_000 });
    expect(() => tracker.checkCap()).not.toThrow();
  });
});

describe('wrapLlmClientWithBudget', () => {
  it('accumulates across chatWithTools calls and throws when cap exceeded', async () => {
    const responses: LlmToolChatResponse[] = [
      { content: [], stopReason: 'end_turn', usage: { inputTokens: 500_000, outputTokens: 100 } },
      { content: [], stopReason: 'end_turn', usage: { inputTokens: 500_000, outputTokens: 100 } },
      { content: [], stopReason: 'end_turn', usage: { inputTokens: 500_000, outputTokens: 100 } },
    ];
    let i = 0;
    const inner: LlmClient = {
      chat: vi.fn(),
      chatWithTools: vi.fn(async () => responses[i++]!),
    };
    const tracker = new BudgetTracker(3);
    const wrapped = wrapLlmClientWithBudget(inner, tracker);

    // Round 1: cum ≈ $1.5015 — passes
    await wrapped.chatWithTools!({ messages: [], tools: [] });
    // Round 2: cum ≈ $3.003 — wrapper should throw AFTER accumulating.
    await expect(
      wrapped.chatWithTools!({ messages: [], tools: [] }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(tracker.totalCostUsd).toBeCloseTo(3.003, 3);
  });

  it('accumulates across chat() calls and throws when cap exceeded', async () => {
    const responses: LlmResponse[] = [
      { content: 'a', usage: { inputTokens: 500_000, outputTokens: 100 } },
      { content: 'b', usage: { inputTokens: 500_000, outputTokens: 100 } },
    ];
    let i = 0;
    const inner: LlmClient = {
      chat: vi.fn(async () => responses[i++]!),
    };
    const tracker = new BudgetTracker(2);
    const wrapped = wrapLlmClientWithBudget(inner, tracker);
    await wrapped.chat({ messages: [] });
    await expect(wrapped.chat({ messages: [] })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('does not wrap chatWithTools when inner does not expose it', () => {
    const inner: LlmClient = { chat: vi.fn() };
    const tracker = new BudgetTracker(10);
    const wrapped = wrapLlmClientWithBudget(inner, tracker);
    expect(wrapped.chatWithTools).toBeUndefined();
  });
});
