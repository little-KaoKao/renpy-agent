// Synthetic benchmark: simulates the registry write pattern on a scene with
// 5 BGM + 30 voice + 10 SFX generators (roughly a 50-line project per the
// §3.1 description). Each "generator" does a configurable fake "RunningHub
// wait" (80ms) + real upsertRegistryEntry on a temp registry.
//
// Before-number (v0.6 serial) is emulated by limit=1 per batch + each batch
// awaited in sequence. After-number (v0.7) uses limit=4 per batch +
// Promise.all across groups — same pattern that audio-ui.ts now takes.
//
// Run: `node scripts/bench-registry-concurrency.mjs` (no key required).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { upsertRegistryEntry } from '../dist/assets/registry.js';
import { mapWithConcurrency } from '../dist/assets/concurrency.js';

const ITEM_DELAY_MS = 80;
const BGM_COUNT = 5;
const VOICE_COUNT = 30;
const SFX_COUNT = 10;

function makeEntry(kind, i) {
  return {
    placeholderId: `${kind}:${kind}:${i}`,
    logicalKey: `${kind}:${i}`,
    assetType: kind,
    status: 'ready',
    realAssetLocalPath: `audio/${kind}/${i}.mp3`,
    remoteAssetUri: `https://cdn/${kind}/${i}.mp3`,
    updatedAt: new Date().toISOString(),
  };
}

async function simulateGenerator(registryPath, kind, i) {
  await new Promise((r) => setTimeout(r, ITEM_DELAY_MS));
  await upsertRegistryEntry(registryPath, makeEntry(kind, i));
}

async function runSerialV06(registryPath) {
  // Groups serial, items serial within each group.
  for (let i = 0; i < BGM_COUNT; i++) await simulateGenerator(registryPath, 'bgm_track', i);
  for (let i = 0; i < VOICE_COUNT; i++) await simulateGenerator(registryPath, 'voice_line', i);
  for (let i = 0; i < SFX_COUNT; i++) await simulateGenerator(registryPath, 'sfx', i);
}

async function runParallelV07(registryPath) {
  const LIMIT = 4;
  await Promise.all([
    mapWithConcurrency(Array.from({ length: BGM_COUNT }, (_, i) => i), LIMIT, (i) =>
      simulateGenerator(registryPath, 'bgm_track', i),
    ),
    mapWithConcurrency(Array.from({ length: VOICE_COUNT }, (_, i) => i), LIMIT, (i) =>
      simulateGenerator(registryPath, 'voice_line', i),
    ),
    mapWithConcurrency(Array.from({ length: SFX_COUNT }, (_, i) => i), LIMIT, (i) =>
      simulateGenerator(registryPath, 'sfx', i),
    ),
  ]);
}

async function time(label, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'registry-bench-'));
  try {
    const registryPath = resolve(dir, 'asset-registry.json');
    const t0 = performance.now();
    await fn(registryPath);
    const ms = performance.now() - t0;
    console.log(`${label.padEnd(28)} ${ms.toFixed(0)}ms`);
    return ms;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const N = BGM_COUNT + VOICE_COUNT + SFX_COUNT;
console.log(`simulated items: ${N} (${BGM_COUNT} bgm + ${VOICE_COUNT} voice + ${SFX_COUNT} sfx)`);
console.log(`per-item fake latency: ${ITEM_DELAY_MS}ms\n`);

const before = await time('v0.6 serial (limit=1)', runSerialV06);
const after = await time('v0.7 parallel (limit=4)', runParallelV07);

console.log(
  `\nspeedup: ${(before / after).toFixed(2)}x (${(((before - after) / before) * 100).toFixed(0)}% reduction)`,
);
