import { describe, it, expect, vi } from 'vitest';
import { retryJsonParse } from './retry.js';

describe('retryJsonParse', () => {
  it('returns on first success without retrying', async () => {
    const attempt = vi.fn(async () => 42);
    const result = await retryJsonParse({ attempt });
    expect(result).toBe(42);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries once on SyntaxError and succeeds', async () => {
    let calls = 0;
    const result = await retryJsonParse({
      attempt: async () => {
        calls++;
        if (calls === 1) throw new SyntaxError('Expected , or } at position 42');
        return 'ok';
      },
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('retries on assertion-style "Planner output ..." errors', async () => {
    let calls = 0;
    const result = await retryJsonParse({
      attempt: async () => {
        calls++;
        if (calls === 1) throw new Error('Planner output missing required string field: tone');
        return { ok: true };
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('does NOT retry on non-retriable errors (e.g. auth)', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('401 Unauthorized');
    });
    await expect(retryJsonParse({ attempt })).rejects.toThrow('401 Unauthorized');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts retries of retriable errors', async () => {
    const attempt = vi.fn(async () => {
      throw new SyntaxError('bad json');
    });
    await expect(retryJsonParse({ attempt, maxAttempts: 2 })).rejects.toThrow('bad json');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('fires onRetry between attempts', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retryJsonParse({
      attempt: async () => {
        calls++;
        if (calls === 1) throw new SyntaxError('bad');
        return 1;
      },
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(SyntaxError), 1);
  });
});
