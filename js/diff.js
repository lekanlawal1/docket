// Comparing two versions of a document word by word. Each version is read as one stream of
// words, so a paragraph that's only re-wrapped onto different lines or pages isn't a change.
// No DOM, so the tests run it in Node.

const QUOTES = [[/[‘’]/g, "'"], [/[“”]/g, '"'], [/[–—]/g, "-"]];

function key(word, loose) {
  let k = word;
  for (const [re, to] of QUOTES) k = k.replace(re, to);
  if (!loose) return k;
  // loose: ignore capitals and punctuation, but a token that is only punctuation still counts
  const bare = k.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return bare || k;
}

// pages: an array of page texts. Returns [{ text, page, key }], page 0-based.
export function words(pages, { loose = false } = {}) {
  const out = [];
  pages.forEach((text, page) => {
    // "infor-" at the end of a line and "mation" on the next are one word
    const joined = String(text).replace(/(\p{L})-\n\s*(\p{Ll})/gu, "$1$2");
    for (const m of joined.matchAll(/\S+/g)) out.push({ text: m[0], page, key: key(m[0], loose) });
  });
  return out;
}

// ---- the diff itself
// Common ends are trimmed; small middles get an exact longest-common-subsequence table; big
// ones are split at words that appear exactly once in both versions (patience diff), which keeps
// whole contracts fast. Returns a list of [op, i, j]: "=" both, "-" only in a, "+" only in b.

const TABLE_LIMIT = 4_000_000;

export function diff(a, b) {
  const ops = [];
  walk(a, 0, a.length, b, 0, b.length, ops);
  return ops;
}

function walk(a, a0, a1, b, b0, b1, ops) {
  // shared start and end
  const head = [];
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) head.push(["=", a0++, b0++]);
  const tail = [];
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) tail.unshift(["=", --a1, --b1]);
  ops.push(...head);

  const n = a1 - a0, m = b1 - b0;
  if (!n || !m) {
    for (let i = a0; i < a1; i++) ops.push(["-", i, b0]);
    for (let j = b0; j < b1; j++) ops.push(["+", a1, j]);
  } else if (n * m <= TABLE_LIMIT) {
    table(a, a0, a1, b, b0, b1, ops);
  } else {
    const anchors = uniqueAnchors(a, a0, a1, b, b0, b1);
    if (!anchors.length) {
      // nothing to line the two up by: call the whole stretch replaced
      for (let i = a0; i < a1; i++) ops.push(["-", i, b0]);
      for (let j = b0; j < b1; j++) ops.push(["+", a1, j]);
    } else {
      let ai = a0, bj = b0;
      for (const [i, j] of anchors) {
        walk(a, ai, i, b, bj, j, ops);
        ops.push(["=", i, j]);
        ai = i + 1; bj = j + 1;
      }
      walk(a, ai, a1, b, bj, b1, ops);
    }
  }
  ops.push(...tail);
}

function table(a, a0, a1, b, b0, b1, ops) {
  const n = a1 - a0, m = b1 - b0, w = m + 1;
  const L = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = a[a0 + i] === b[b0 + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) { ops.push(["=", a0 + i, b0 + j]); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push(["-", a0 + i, b0 + j]); i++; }
    else { ops.push(["+", a0 + i, b0 + j]); j++; }
  }
  for (; i < n; i++) ops.push(["-", a0 + i, b1]);
  for (; j < m; j++) ops.push(["+", a1, b0 + j]);
}

// Words that occur exactly once on each side, kept in an order both sides agree on (the
// longest increasing run of their positions).
function uniqueAnchors(a, a0, a1, b, b0, b1) {
  const count = (arr, s, e) => { const c = new Map(); for (let k = s; k < e; k++) c.set(arr[k], (c.get(arr[k]) || 0) + 1); return c; };
  const ca = count(a, a0, a1), cb = count(b, b0, b1);
  const where = new Map();
  for (let j = b0; j < b1; j++) if (cb.get(b[j]) === 1) where.set(b[j], j);
  const pairs = [];
  for (let i = a0; i < a1; i++) if (ca.get(a[i]) === 1 && where.has(a[i])) pairs.push([i, where.get(a[i])]);
  // longest increasing subsequence on j, patience sorting
  const tails = [], prev = new Array(pairs.length);
  pairs.forEach(([, j], k) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
    prev[k] = lo ? tails[lo - 1] : -1;
    tails[lo] = k;
  });
  const out = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]) out.unshift(pairs[k]);
  return out;
}

// ---- turning the raw diff into changes a person can read

const NUMBER = /\d/;
const CONTEXT = 8;     // words of unchanged text shown either side of a change
const BRIDGE = 2;      // unchanged runs this short between two edits join them into one change

export function compare(oldPages, newPages, { loose = false } = {}) {
  const A = words(oldPages, { loose }), B = words(newPages, { loose });
  const ops = diff(A.map((w) => w.key), B.map((w) => w.key));

  // runs of the same op
  const runs = [];
  for (const op of ops) {
    const last = runs.at(-1);
    if (last && (last.op === "=") === (op[0] === "=")) last.items.push(op);
    else runs.push({ op: op[0] === "=" ? "=" : "x", items: [op] });
  }
  // join edits separated by only a word or two of unchanged text
  const merged = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const prev = merged.at(-1);
    if (run.op === "=" && run.items.length <= BRIDGE && prev?.op === "x" && runs[r + 1]?.op === "x") {
      prev.items.push(...run.items.flatMap(([, i, j]) => [["-", i, j], ["+", i, j]]), ...runs[r + 1].items);
      r++;
    } else if (run.op === "x" && prev?.op === "x") prev.items.push(...run.items);
    else merged.push({ op: run.op, items: [...run.items] });
  }

  const changes = [];
  merged.forEach((run, r) => {
    if (run.op !== "x") return;
    const removed = run.items.filter(([o]) => o === "-").map(([, i]) => A[i]);
    const added = run.items.filter(([o]) => o === "+").map(([, , j]) => B[j]);
    const before = merged[r - 1]?.op === "=" ? merged[r - 1].items.slice(-CONTEXT).map(([, , j]) => B[j].text) : [];
    const after = merged[r + 1]?.op === "=" ? merged[r + 1].items.slice(0, CONTEXT).map(([, , j]) => B[j].text) : [];
    // where it is: the edited words themselves, or else the unchanged word just before them
    // (text added at the end of a page belongs to that page, not the next one)
    const [, i0, j0] = run.items[0];
    const anchorOld = removed[0]?.page ?? A[i0 - 1]?.page ?? A[i0]?.page ?? 0;
    const anchorNew = added[0]?.page ?? B[j0 - 1]?.page ?? B[j0]?.page ?? 0;
    changes.push({
      kind: removed.length && added.length ? "changed" : removed.length ? "removed" : "added",
      removed: removed.map((w) => w.text).join(" "),
      added: added.map((w) => w.text).join(" "),
      before: before.join(" "),
      after: after.join(" "),
      oldPage: anchorOld + 1,
      newPage: anchorNew + 1,
      numbers: [...removed, ...added].some((w) => NUMBER.test(w.text)),
      size: removed.length + added.length,
    });
  });

  const same = ops.filter(([o]) => o === "=").length;
  return {
    changes,
    stats: {
      oldWords: A.length,
      newWords: B.length,
      added: ops.filter(([o]) => o === "+").length,
      removed: ops.filter(([o]) => o === "-").length,
      // share of the longer version that's unchanged
      same: Math.max(A.length, B.length) ? same / Math.max(A.length, B.length) : 1,
    },
  };
}

// The changes as plain text, for saving or pasting into an email.
export function report(result, { oldName = "original", newName = "new version" } = {}) {
  const { changes, stats } = result;
  const lines = [`Comparing "${oldName}" with "${newName}"`,
    `${changes.length} change${changes.length === 1 ? "" : "s"}: ${stats.removed} word${stats.removed === 1 ? "" : "s"} removed, ${stats.added} added. ${Math.round(stats.same * 100)}% unchanged.`, ""];
  changes.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.kind[0].toUpperCase() + c.kind.slice(1)} (page ${c.oldPage} of the original, page ${c.newPage} of the new version)${c.numbers ? " [numbers]" : ""}`);
    if (c.before || c.after) lines.push(`   ...${c.before} [ ] ${c.after}...`);
    if (c.removed) lines.push(`   Removed: ${c.removed}`);
    if (c.added) lines.push(`   Added:   ${c.added}`);
    lines.push("");
  });
  return lines.join("\n");
}
