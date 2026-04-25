import { describe, expect, it } from 'vitest';
import { repairCjkInnerQuotes } from './json-repair.js';

describe('repairCjkInnerQuotes', () => {
  it('returns input unchanged when no CJK"X pattern exists', () => {
    const ok = '{"name": "plain english"}';
    expect(repairCjkInnerQuotes(ok)).toBe(ok);
  });

  it('returns input unchanged for valid JSON with properly escaped inner quotes', () => {
    const ok = '{"text": "她说\\"别走\\"然后离开"}';
    expect(repairCjkInnerQuotes(ok)).toBe(ok);
  });

  it('rewrites raw CJK-framed inner quotes to fullwidth brackets and makes JSON parseable', () => {
    // Simulates the exact pattern that broke v6's Planner output.
    const broken =
      '{"text": "她轻声说"永远不离开"然后转身"}';
    const repaired = repairCjkInnerQuotes(broken);
    expect(repaired).toBe('{"text": "她轻声说「永远不离开」然后转身"}');
    expect(() => JSON.parse(repaired)).not.toThrow();
    const obj = JSON.parse(repaired) as { text: string };
    expect(obj.text).toBe('她轻声说「永远不离开」然后转身');
  });

  it('handles multiple inner-quote pairs in one string', () => {
    const broken =
      '{"text": "他说"走"然后她说"别走"最终离开"}';
    const repaired = repairCjkInnerQuotes(broken);
    expect(() => JSON.parse(repaired)).not.toThrow();
    const obj = JSON.parse(repaired) as { text: string };
    expect(obj.text).toContain('「走」');
    expect(obj.text).toContain('「别走」');
  });

  it('does not corrupt ASCII-only values even if CJK appears elsewhere in the doc', () => {
    const input =
      '{"zh": "中文", "en": "plain english \\"with quotes\\" inside"}';
    const repaired = repairCjkInnerQuotes(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
    const obj = JSON.parse(repaired) as { zh: string; en: string };
    expect(obj.en).toBe('plain english "with quotes" inside');
  });
});
