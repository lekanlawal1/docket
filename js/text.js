// The "Read" pier: a summary made of the document's own sentences, and a list of the dates,
// amounts and contact details in it. No AI and no network: nothing here can invent a word,
// because everything it returns is cut out of the text it was given.

const STOP = new Set(("a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its " +
  "may me might more most must my no not of on or our out over shall she should so such than that the their them then there these they " +
  "this those to under up upon us was we were what when where which while who will with would you your also any all each other same " +
  "only own very just being both between during before after above below again further once here why how").split(" "));

// Sentences, keeping the exact text. Abbreviations like "e.g." and "No. 4" don't end one.
export function sentences(text) {
  const clean = String(text).replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // a break is end punctuation (maybe with a closing quote) before a capital, a digit or the end
  const end = /[.!?]+["”’)]?(?=\s+["“(]?[A-Z0-9]|\s*$)/g;
  const pieces = [];
  let start = 0;
  for (const m of clean.matchAll(end)) {
    pieces.push(clean.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  if (clean.slice(start).trim()) pieces.push(clean.slice(start).trim());

  const out = [];
  let carry = "";
  for (const piece of pieces) {
    const joined = carry ? `${carry} ${piece}` : piece;
    if (/\b(?:e\.g|i\.e|etc|vs|No|Mr|Mrs|Ms|Dr|St|Inc|Ltd|Co|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|approx)\.$/i.test(joined)) {
      carry = joined;
      continue;
    }
    carry = "";
    if (joined) out.push(joined);
  }
  if (carry) out.push(carry);
  return out;
}

const words = (s) => (s.toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));

// Picks the sentences that carry the most of the document's frequent words, with a little
// weight for coming early (introductions tend to say what a document is about). Returns
// them in the order they appear, so the summary still reads in sequence.
export function summarize(text, count = 5) {
  const all = sentences(text).filter((s) => s.split(/\s+/).length >= 6 && s.length <= 600);
  if (all.length <= count) return { picked: all, total: all.length };
  const freq = new Map();
  for (const s of all) for (const w of new Set(words(s))) freq.set(w, (freq.get(w) || 0) + 1);
  const top = Math.max(...freq.values());
  const scored = all.map((s, i) => {
    const ws = words(s);
    const sum = ws.reduce((n, w) => n + (freq.get(w) || 0) / top, 0);
    const early = 1 + 0.25 * Math.max(0, 1 - i / Math.max(8, all.length * 0.15));
    return { s, i, score: (sum / Math.sqrt(Math.max(ws.length, 4))) * early };
  });
  const picked = scored.sort((a, b) => b.score - a.score).slice(0, count).sort((a, b) => a.i - b.i).map((x) => x.s);
  return { picked, total: all.length };
}

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const PATTERNS = {
  Dates: new RegExp([
    `\\b\\d{4}-\\d{2}-\\d{2}\\b`,
    `\\b\\d{1,2}[/.]\\d{1,2}[/.](?:\\d{4}|\\d{2})\\b`,
    `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?\\b`,
  ].join("|"), "gi"),
  Amounts: /(?:(?:US|CA|C|A)?\$|€|£)\s?\d[\d,]*(?:\.\d{2})?\b|\b\d[\d,]*(?:\.\d{2})?\s?(?:USD|CAD|EUR|GBP|dollars)\b/gi,
  Percentages: /\b\d+(?:\.\d+)?\s?%/g,
  Emails: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  Links: /\b(?:https?:\/\/|www\.)[^\s<>()"']+[^\s<>()"'.,;:!?]/gi,
  "Phone numbers": /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
};

// { Dates: [{ value, count }], ... } in the order each first appears
export function findItems(text) {
  const out = {};
  const flat = String(text).replace(/\s+/g, " ");
  for (const [kind, re] of Object.entries(PATTERNS)) {
    const seen = new Map();
    for (const m of flat.matchAll(re)) {
      const v = m[0].trim();
      seen.set(v, (seen.get(v) || 0) + 1);
    }
    out[kind] = [...seen].map(([value, count]) => ({ value, count }));
  }
  return out;
}
