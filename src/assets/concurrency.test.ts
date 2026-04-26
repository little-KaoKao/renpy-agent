import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_CONCURRENCY,
  ASSET_CONCURRENCY_ENV,
  mapWithConcurrency,
  resolveAssetConcurrency,
} from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('returns results in input order even when tasks finish out of order', async () => {
    const delays = [30, 5, 15, 1, 20];
    const out = await mapWithConcurrency(delays, 3, async (d, i) => {
      await new Promise((r) => setTimeout(r, d));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than `limit` tasks in flight', async () => {
    let inflight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually parallelizing
  });

  it('handles empty input without spawning workers', async () => {
    const out = await mapWithConcurrency([], 4, async () => {
      throw new Error('should not run');
    });
    expect(out).toEqual([]);
  });

  it('treats non-positive limit as 1 (serial fallback)', async () => {
    let peak = 0;
    let inflight = 0;
    await mapWithConcurrency([1, 2, 3, 4], 0, async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 1));
      inflight--;
    });
    expect(peak).toBe(1);
  });

  it('rejects when any task throws', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('resolveAssetConcurrency', () => {
  it('prefers the explicit override when positive', () => {
    expect(resolveAssetConcurrency(8)).toBe(8);
  });

  it('ignores non-positive / non-finite overrides', () => {
    expect(resolveAssetConcurrency(0)).toBe(DEFAULT_ASSET_CONCURRENCY);
    expect(resolveAssetConcurrency(-3)).toBe(DEFAULT_ASSET_CONCURRENCY);
    expect(resolveAssetConcurrency(Number.NaN)).toBe(DEFAULT_ASSET_CONCURRENCY);
  });

  it('falls back to the env var, then to the default', () => {
    const prev = process.env[ASSET_CONCURRENCY_ENV];
    try {
      process.env[ASSET_CONCURRENCY_ENV] = '7';
      expect(resolveAssetConcurrency()).toBe(7);

      process.env[ASSET_CONCURRENCY_ENV] = 'not-a-number';
      expect(resolveAssetConcurrency()).toBe(DEFAULT_ASSET_CONCURRENCY);

      delete process.env[ASSET_CONCURRENCY_ENV];
      expect(resolveAssetConcurrency()).toBe(DEFAULT_ASSET_CONCURRENCY);
    } finally {
      if (prev === undefined) delete process.env[ASSET_CONCURRENCY_ENV];
      else process.env[ASSET_CONCURRENCY_ENV] = prev;
    }
  });
});
