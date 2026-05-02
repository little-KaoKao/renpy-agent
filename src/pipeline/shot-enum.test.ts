import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeShot,
  normalizeStoryboarderOutput,
  resetLegacyWarnDedup,
} from './shot-enum.js';

describe('normalizeShot — legacy workspace compat', () => {
  beforeEach(() => resetLegacyWarnDedup());
  afterEach(() => vi.restoreAllMocks());

  it('passes through v0.7 enum shape unchanged (no warn)', () => {
    const warn = vi.fn();
    const out = normalizeShot(
      {
        shotNumber: 1,
        description: 'd',
        characters: ['A'],
        sceneName: 's',
        staging: 'solo_center',
        transform: 'stand',
        transition: 'fade',
        effects: ['sakura'],
        dialogueLines: [{ speaker: 'A', text: 'hi' }],
      },
      warn,
    );
    expect(out.staging).toBe('solo_center');
    expect(out.transform).toBe('stand');
    expect(out.transition).toBe('fade');
    expect(out.effects).toEqual(['sakura']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('maps M5-era legacy prose → enums with aliases', () => {
    const warn = vi.fn();
    const out = normalizeShot(
      {
        shotNumber: 1,
        description: 'd',
        characters: [],
        sceneName: 's',
        staging: 'enter',
        transforms: 'stand breathing',
        transition: 'fade',
        effects: 'sakura particles drifting',
        dialogueLines: [{ speaker: 'v', text: '.' }],
      },
      warn,
    );
    expect(out.staging).toBe('solo_center'); // enter → solo_center alias
    expect(out.transform).toBe('stand'); // "stand breathing" substring match
    expect(out.effects).toEqual(['sakura']); // sakura keyword in prose
    expect(out.transforms_raw).toBe('stand breathing');
    expect(out.staging_raw).toBe('enter');
    expect(out.effects_raw).toBe('sakura particles drifting');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back + warns on unknown transform value', () => {
    const warn = vi.fn();
    const out = normalizeShot(
      {
        shotNumber: 1,
        description: 'd',
        characters: [],
        sceneName: 's',
        staging: 'solo_center',
        transforms: 'quantum teleport gimbal',
        transition: 'none',
        effects: [],
        dialogueLines: [{ speaker: 'v', text: '.' }],
      },
      warn,
    );
    expect(out.transform).toBe('stand');
    expect(warn).toHaveBeenCalledWith('transform', 'quantum teleport gimbal');
  });

  it('dedupes warnings across the process — same (kind, value) only warns once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Call normalizeShot twice with the same unknown transform.
    const input = {
      shotNumber: 1,
      description: 'd',
      characters: [],
      sceneName: 's',
      staging: 'solo_center',
      transforms: 'unicorn_burst',
      transition: 'none',
      effects: [],
      dialogueLines: [{ speaker: 'v', text: '.' }],
    };
    normalizeShot(input);
    normalizeShot(input);
    normalizeShot({ ...input, transforms: 'unicorn_burst' });
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    const hit = warnMessages.filter((m) => m.includes('unicorn_burst'));
    expect(hit).toHaveLength(1);
  });

  it('normalizeStoryboarderOutput maps over shots and preserves cgList / notes', () => {
    const out = normalizeStoryboarderOutput({
      shots: [
        {
          shotNumber: 1,
          description: 'd',
          characters: [],
          sceneName: 's',
          staging: 'enter',
          transforms: 'stand',
          transition: 'fade',
          effects: '',
          dialogueLines: [{ speaker: 'v', text: '.' }],
        },
      ],
      cgList: [{ shotNumber: 1, title: 't', description: 'x' }],
      notes: 'n',
    });
    expect(out.shots[0]!.staging).toBe('solo_center');
    expect(out.cgList).toEqual([{ shotNumber: 1, title: 't', description: 'x' }]);
    expect(out.notes).toBe('n');
  });
});
