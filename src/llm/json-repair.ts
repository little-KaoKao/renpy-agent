// Best-effort JSON repair for LLM outputs that slipped raw ASCII double-quotes
// inside Chinese string values. The LLM was told (see planner/writer/storyboarder
// system prompts) to use 「」 or backslash-escape, but temperature=0.6-0.7 means
// it occasionally forgets. Rather than pay for another round-trip, try a local
// heuristic first.
//
// Heuristic: inside a JSON string value (between two unescaped quotes), any
// INNER ASCII double-quote that is immediately preceded by a CJK character AND
// immediately followed by a CJK character must be a typographic quote the model
// meant to include literally, not a string terminator. Replace each such pair
// with full-width 「」.
//
// Called only as a second-chance retry before giving up — never masks bugs in
// the LLM prompt, just survives occasional typos.

export function repairCjkInnerQuotes(text: string): string {
  // "CJK context" for the purposes of this repair:
  //   - Unified ideographs (Chinese/Japanese) — U+4E00..U+9FFF, U+3400..U+4DBF
  //   - Japanese kana — U+3040..U+309F (hiragana), U+30A0..U+30FF (katakana)
  //   - Common CJK punctuation that follows/precedes quoted speech:
  //     。,、?!:;…———fullwidth parens 「」『』etc.
  //     (U+3000..U+303F general punctuation, U+FF00..U+FFEF fullwidth forms)
  // A raw `"` surrounded by any mix of these is almost certainly the LLM
  // slipping a typographic quote into a Chinese sentence, not a string boundary.
  const CJK_RE = /[぀-ヿ㐀-䶿一-鿿　-〿＀-￯]/;
  // Fast path: no CJK"X pattern, nothing to repair.
  if (!new RegExp(CJK_RE.source + '"').test(text)) return text;

  // Single left-to-right pass. Track whether we're inside a JSON string value.
  // Any ASCII `"` that has a CJK char on both sides is an inner quote; toggle
  // between opening (「) and closing (」) across the pair.
  const chars = [...text];
  let inString = false;
  let escaped = false;
  let innerOpen = false; // toggles inside a string as we rewrite inner pairs
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch !== '"') continue;

    if (!inString) {
      inString = true;
      innerOpen = false;
      continue;
    }
    // inString === true: decide inner quote vs string terminator.
    const prev = chars[i - 1] ?? '';
    const next = chars[i + 1] ?? '';
    if (CJK_RE.test(prev) && CJK_RE.test(next)) {
      chars[i] = innerOpen ? '」' : '「';
      innerOpen = !innerOpen;
      continue;
    }
    // Plain string terminator.
    inString = false;
    innerOpen = false;
  }
  return chars.join('');
}
