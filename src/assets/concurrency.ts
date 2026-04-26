// Bounded concurrency helper — keeps at most `limit` worker tasks inflight at
// the same time while the total work list can be any size. We need this
// because the audio/visual stages can easily produce 50+ items; firing every
// generate-* call at RunningHub simultaneously would trip rate limits and
// blow up retry noise.
//
// Design notes:
//   - preserves input order in the output array (same index in → same index out)
//   - never fails the whole pool because of one item; `run` is expected to
//     handle or rethrow its own errors (audio-ui / visual-stage already catch
//     per-item errors)
//   - `limit <= 0` is treated as 1 (fail-safe)

/** Environment override for the default cap inside one batch. */
export const ASSET_CONCURRENCY_ENV = 'RENPY_AGENT_ASSET_CONCURRENCY';
export const DEFAULT_ASSET_CONCURRENCY = 4;

export function resolveAssetConcurrency(override?: number): number {
  if (typeof override === 'number' && override > 0) return Math.floor(override);
  const raw = process.env[ASSET_CONCURRENCY_ENV];
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_ASSET_CONCURRENCY;
}

export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const effectiveLimit = limit > 0 ? Math.floor(limit) : 1;
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await run(items[i]!, i);
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(effectiveLimit, items.length);
  for (let w = 0; w < n; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
