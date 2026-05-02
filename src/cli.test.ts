import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs - generate (legacy form)', () => {
  it('joins positional args into inspiration', () => {
    const r = parseArgs(['a', 'story', 'about', 'cats']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.inspiration).toBe('a story about cats');
    expect(r.storyName).toBeUndefined();
  });

  it('parses --name value form', () => {
    const r = parseArgs(['--name', 'sakura', 'night', 'under', 'trees']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.storyName).toBe('sakura');
    expect(r.inspiration).toBe('night under trees');
  });

  it('parses --name=value form', () => {
    const r = parseArgs(['--name=sakura', 'x', 'y']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.storyName).toBe('sakura');
    expect(r.inspiration).toBe('x y');
  });

  it('throws when --name has no value', () => {
    expect(() => parseArgs(['--name'])).toThrow(/requires a value/);
  });

  it('parses --audio-ui flag', () => {
    const r = parseArgs(['--audio-ui', 'x', 'y']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.audioUi).toBe(true);
    expect(r.inspiration).toBe('x y');
  });

  it('leaves audioUi unset when flag missing', () => {
    const r = parseArgs(['x', 'y']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.audioUi).toBeUndefined();
  });
});

describe('parseArgs - generate (explicit subcommand)', () => {
  it('accepts `generate <inspiration>`', () => {
    const r = parseArgs(['generate', 'cats', 'on', 'moon']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.inspiration).toBe('cats on moon');
  });

  it('accepts `generate --name ... <inspiration>`', () => {
    const r = parseArgs(['generate', '--name', 'demo', 'a', 'b']);
    if (r.kind !== 'generate') throw new Error('expected generate');
    expect(r.storyName).toBe('demo');
    expect(r.inspiration).toBe('a b');
  });
});

describe('parseArgs - help', () => {
  it('recognises --help', () => {
    expect(parseArgs(['--help']).kind).toBe('help');
  });
  it('recognises -h', () => {
    expect(parseArgs(['-h']).kind).toBe('help');
  });
});

describe('parseArgs - modify character', () => {
  it('parses required flags', () => {
    const r = parseArgs([
      'modify', 'character', 'demo',
      '--name', 'Baiying',
      '--visual', 'short hair',
    ]);
    if (r.kind !== 'modify' || r.op !== 'character') throw new Error('expected modify character');
    expect(r.storyName).toBe('demo');
    expect(r.characterName).toBe('Baiying');
    expect(r.visualDescription).toBe('short hair');
    expect(r.rebuild).toBe(false);
  });

  it('recognises --rebuild', () => {
    const r = parseArgs([
      'modify', 'character', 'demo',
      '--name', 'X', '--visual', 'y', '--rebuild',
    ]);
    if (r.kind !== 'modify' || r.op !== 'character') throw new Error('expected modify character');
    expect(r.rebuild).toBe(true);
  });

  it('errors when <story> is missing', () => {
    expect(() =>
      parseArgs(['modify', 'character', '--name', 'X', '--visual', 'y']),
    ).toThrow(/<story> is required/);
  });

  it('errors when --name is missing', () => {
    expect(() =>
      parseArgs(['modify', 'character', 'demo', '--visual', 'y']),
    ).toThrow(/--name is required/);
  });

  it('errors when --visual is missing', () => {
    expect(() =>
      parseArgs(['modify', 'character', 'demo', '--name', 'X']),
    ).toThrow(/--visual is required/);
  });
});

describe('parseArgs - modify dialogue', () => {
  it('parses required flags', () => {
    const r = parseArgs([
      'modify', 'dialogue', 'demo',
      '--shot', '3', '--line', '0', '--text', 'hi',
    ]);
    if (r.kind !== 'modify' || r.op !== 'dialogue') throw new Error('expected modify dialogue');
    expect(r.shotNumber).toBe(3);
    expect(r.lineIndex).toBe(0);
    expect(r.text).toBe('hi');
  });

  it('errors when --shot is missing', () => {
    expect(() =>
      parseArgs(['modify', 'dialogue', 'demo', '--line', '0', '--text', 'x']),
    ).toThrow(/--shot is required/);
  });

  it('errors when --shot is non-integer', () => {
    expect(() =>
      parseArgs(['modify', 'dialogue', 'demo', '--shot', 'abc', '--line', '0', '--text', 'x']),
    ).toThrow(/--shot must be an integer/);
  });
});

describe('parseArgs - modify shots', () => {
  it('parses --order', () => {
    const r = parseArgs(['modify', 'shots', 'demo', '--order', '3,1,2']);
    if (r.kind !== 'modify' || r.op !== 'shots') throw new Error('expected modify shots');
    expect(r.order).toEqual([3, 1, 2]);
  });

  it('errors when --order has non-integer', () => {
    expect(() =>
      parseArgs(['modify', 'shots', 'demo', '--order', '1,2,3,abc']),
    ).toThrow(/comma-separated integers/);
  });

  it('errors when --order is missing', () => {
    expect(() =>
      parseArgs(['modify', 'shots', 'demo']),
    ).toThrow(/--order is required/);
  });
});

describe('parseArgs - v5-modify', () => {
  it('parses story + intent as quoted positional', () => {
    const r = parseArgs(['v5-modify', 'demo', 'change Baiying to short hair']);
    if (r.kind !== 'v5-modify') throw new Error('expected v5-modify');
    expect(r.storyName).toBe('demo');
    expect(r.modifyIntent).toBe('change Baiying to short hair');
    expect(r.budgetCapUsd).toBeUndefined();
  });

  it('joins multiple positional tokens into one intent string', () => {
    const r = parseArgs(['v5-modify', 'demo', 'change', 'Baiying', 'to', 'short', 'hair']);
    if (r.kind !== 'v5-modify') throw new Error('expected v5-modify');
    expect(r.modifyIntent).toBe('change Baiying to short hair');
  });

  it('parses --budget-cap value form', () => {
    const r = parseArgs(['v5-modify', 'demo', '--budget-cap', '1.5', 'change things']);
    if (r.kind !== 'v5-modify') throw new Error('expected v5-modify');
    expect(r.budgetCapUsd).toBeCloseTo(1.5);
    expect(r.modifyIntent).toBe('change things');
  });

  it('parses --budget-cap=value form', () => {
    const r = parseArgs(['v5-modify', 'demo', '--budget-cap=3', 'change things']);
    if (r.kind !== 'v5-modify') throw new Error('expected v5-modify');
    expect(r.budgetCapUsd).toBe(3);
  });

  it('errors when <story> missing', () => {
    expect(() => parseArgs(['v5-modify'])).toThrow(/<story> is required/);
  });

  it('errors when <intent> empty', () => {
    expect(() => parseArgs(['v5-modify', 'demo'])).toThrow(/<intent> is required/);
  });

  it('errors when --budget-cap is not a positive number', () => {
    expect(() => parseArgs(['v5-modify', 'demo', '--budget-cap', 'abc', 'x'])).toThrow(
      /positive number/,
    );
    expect(() => parseArgs(['v5-modify', 'demo', '--budget-cap', '0', 'x'])).toThrow(
      /positive number/,
    );
  });
});

describe('parseArgs - rebuild', () => {
  it('parses `rebuild <story>`', () => {
    const r = parseArgs(['rebuild', 'demo']);
    if (r.kind !== 'rebuild') throw new Error('expected rebuild');
    expect(r.storyName).toBe('demo');
  });

  it('errors when <story> is missing', () => {
    expect(() => parseArgs(['rebuild'])).toThrow(/<story> is required/);
  });
});
