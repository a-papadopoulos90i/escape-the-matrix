// Search that finds Greek titles however they are typed: with or without accents, in capitals, or in
// greeklish ("xartia" finds "Χαρτιά", "pantelh" finds "Παντελή", "8ermostath" finds "θερμοστάτη").
// Each Latin letter (and the usual pairs: th, ps, ks, ch, ou, mp, nt, gk...) stands for the Greek letters
// people write it for, so one query matches every common spelling.

/** Lower case, accents dropped and ς read as σ: "Πέμπτη" → "πεμπτη". */
export const searchable = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ');

// Two Latin letters that people write for one Greek letter (or a Greek pair).
const PAIRS = {
  th: 'θ',
  ps: 'ψ',
  ks: 'ξ',
  ch: 'χ',
  kh: 'χ',
  ph: 'φ',
  ou: 'ου',
  mp: 'μπ',
  nt: 'ντ',
  gk: 'γκ',
  gg: 'γγ',
  ts: 'τσ',
  tz: 'τζ',
  ai: 'αι',
  ei: 'ει',
  oi: 'οι',
};

// One Latin letter (or digit) and the Greek it is written for.
const LETTERS = {
  a: ['α'],
  b: ['β', 'μπ'],
  c: ['κ', 'σ'],
  d: ['δ', 'ντ'],
  e: ['ε', 'αι', 'η'],
  f: ['φ'],
  g: ['γ', 'γκ'],
  h: ['η', 'χ'],
  i: ['ι', 'η', 'υ', 'ει', 'οι'],
  j: ['τζ'],
  k: ['κ'],
  l: ['λ'],
  m: ['μ'],
  n: ['ν'],
  o: ['ο', 'ω'],
  p: ['π'],
  q: ['κ'],
  r: ['ρ'],
  s: ['σ'],
  t: ['τ'],
  u: ['ου', 'υ'],
  v: ['β'],
  w: ['ω'],
  x: ['χ', 'ξ'],
  y: ['υ', 'ι', 'η'],
  z: ['ζ'],
  8: ['θ'],
  3: ['ξ'],
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const either = (options) => (options.length === 1 ? escape(options[0]) : `(?:${options.map(escape).join('|')})`);
const letter = (ch) => (LETTERS[ch] ? either([ch, ...LETTERS[ch]]) : escape(ch));

/** The query as a pattern that also accepts its Greek spellings (null when it has no Latin letters). */
function greeklishPattern(query) {
  if (!/[a-z38]/.test(query)) return null;
  let pattern = '';
  for (let i = 0; i < query.length; i += 1) {
    const pair = query.slice(i, i + 2);
    if (PAIRS[pair]) {
      // Either the one Greek letter, or the two letters read one by one ("th" in "thalassa" or "tha").
      pattern += `(?:${escape(PAIRS[pair])}|${letter(pair[0])}${letter(pair[1])})`;
      i += 1;
    } else pattern += letter(query[i]);
  }
  return new RegExp(pattern);
}

/** True when `title` matches `query`: as typed (no accents, any case), or the query read as greeklish. */
export function matchesSearch(title, query) {
  const wanted = searchable(query).trim();
  if (!wanted) return true;
  const text = searchable(title);
  if (text.includes(wanted)) return true;
  return greeklishPattern(wanted)?.test(text) ?? false;
}
