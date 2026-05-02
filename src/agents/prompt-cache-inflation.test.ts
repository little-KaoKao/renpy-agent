// Guards the plan §8 cache-inflation invariants: both cacheable system
// segments must exceed Anthropic's 4096-char prompt-cache floor by a comfortable
// margin (≥ 5000 chars) so SDK-level silent drops never recur. Regression gate
// for the M7 Major-1 cache miss.

import { describe, expect, it } from 'vitest';
import { PLANNER_SYSTEM_PROMPT } from './planner.js';
import { buildCacheableSystemPrompt } from './executer.js';
import { POC_REGISTRY, POC_ROLES } from './poc-registry.js';
import { getToolSetForRole } from './tool-binder.js';
import { SCHEMA_DIGEST } from '../schema/galgame-workspace.js';

const CACHE_INFLATION_MIN = 5000;

describe('prompt cache inflation (plan §8)', () => {
  it('SCHEMA_DIGEST itself clears the 4096-char Anthropic cache floor', () => {
    expect(SCHEMA_DIGEST.length).toBeGreaterThanOrEqual(4096);
  });

  it('PLANNER_SYSTEM_PROMPT length ≥ 5000 chars', () => {
    expect(PLANNER_SYSTEM_PROMPT.length).toBeGreaterThanOrEqual(CACHE_INFLATION_MIN);
  });

  it('PLANNER_SYSTEM_PROMPT keeps the 8 planner rules in-order at the top', () => {
    const idx = (n: number): number =>
      PLANNER_SYSTEM_PROMPT.indexOf(`${n}.`);
    for (let i = 1; i <= 8; i++) {
      expect(idx(i)).toBeGreaterThanOrEqual(0);
    }
    // Strict ordering: rule N comes before rule N+1.
    for (let i = 1; i <= 7; i++) {
      expect(idx(i)).toBeLessThan(idx(i + 1));
    }
    // Rule 1 appears before the schema digest marker.
    expect(idx(1)).toBeLessThan(PLANNER_SYSTEM_PROMPT.indexOf('Workspace schema'));
  });

  it.each(POC_ROLES)(
    'Executer cacheable segment for %s ≥ 5000 chars',
    (role) => {
      const set = getToolSetForRole(role);
      const segment = buildCacheableSystemPrompt(
        role,
        POC_REGISTRY[role].description,
        set.schemas,
      );
      expect(segment.length).toBeGreaterThanOrEqual(CACHE_INFLATION_MIN);
    },
  );

  it('Executer cacheable segment keeps the 7 rules in-order at the top', () => {
    const set = getToolSetForRole('producer');
    const segment = buildCacheableSystemPrompt(
      'producer',
      POC_REGISTRY.producer.description,
      set.schemas,
    );
    const idx = (n: number): number => segment.indexOf(`${n}.`);
    for (let i = 1; i <= 7; i++) {
      expect(idx(i)).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i <= 6; i++) {
      expect(idx(i)).toBeLessThan(idx(i + 1));
    }
    expect(idx(1)).toBeLessThan(segment.indexOf('Your role:'));
  });

  it('Executer cacheable segment is deterministic (same inputs → byte-identical output)', () => {
    // Prompt caching relies on byte-identical repeated segments. If this test
    // ever flakes, something dynamic (timestamp, random id, sorted-order drift)
    // has leaked into buildCacheableSystemPrompt and must be removed.
    const set = getToolSetForRole('storyboarder');
    const a = buildCacheableSystemPrompt(
      'storyboarder',
      POC_REGISTRY.storyboarder.description,
      set.schemas,
    );
    const b = buildCacheableSystemPrompt(
      'storyboarder',
      POC_REGISTRY.storyboarder.description,
      set.schemas,
    );
    expect(a).toBe(b);
  });
});
