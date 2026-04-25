import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('joins positional args into inspiration', () => {
    const r = parseArgs(['a', 'story', 'about', 'cats']);
    expect(r.inspiration).toBe('a story about cats');
    expect(r.storyName).toBeUndefined();
  });

  it('parses --name value form', () => {
    const r = parseArgs(['--name', 'sakura', 'night', 'under', 'trees']);
    expect(r.storyName).toBe('sakura');
    expect(r.inspiration).toBe('night under trees');
  });

  it('parses --name=value form', () => {
    const r = parseArgs(['--name=sakura', 'x', 'y']);
    expect(r.storyName).toBe('sakura');
    expect(r.inspiration).toBe('x y');
  });

  it('throws when --name has no value', () => {
    expect(() => parseArgs(['--name'])).toThrow(/requires a value/);
  });

  it('flags help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('parses --audio-ui flag', () => {
    const r = parseArgs(['--audio-ui', 'x', 'y']);
    expect(r.audioUi).toBe(true);
    expect(r.inspiration).toBe('x y');
  });

  it('leaves audioUi unset when flag missing', () => {
    const r = parseArgs(['x', 'y']);
    expect(r.audioUi).toBeUndefined();
  });
});
