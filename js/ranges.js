// Page ranges the way people type them: "1-3, 5, 8-". Pages are 1-based for people and
// 0-based in the returned arrays. No DOM, so the tests run it in Node.

export function parseRanges(text, pageCount) {
  const groups = [];
  const parts = String(text).split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Type some pages, like 1-3, 5.");
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*(?:-|–|to)\s*(\d*)$/i) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`"${part}" isn't a page or a range.`);
    const single = m.length === 2;
    let from = Number(m[1] || 1);
    let to = single ? from : Number(m[2] || pageCount);
    if (from < 1 || to < 1) throw new Error("Pages start at 1.");
    if (from > pageCount || to > pageCount) throw new Error(`This file only has ${pageCount} page${pageCount === 1 ? "" : "s"}.`);
    const step = from <= to ? 1 : -1;               // "5-3" means 5, 4, 3
    const pages = [];
    for (let p = from; p !== to + step; p += step) pages.push(p - 1);
    groups.push(pages);
  }
  return groups;
}

// every N pages: chunks(7, 3) -> [[0,1,2],[3,4,5],[6]]
export function chunks(pageCount, size) {
  if (!(size >= 1)) throw new Error("Pick at least 1 page per file.");
  const out = [];
  for (let i = 0; i < pageCount; i += size) out.push([...Array(Math.min(size, pageCount - i)).keys()].map((k) => i + k));
  return out;
}

export const describe = (pages) => {
  if (!pages.length) return "";
  const bits = [];
  let start = pages[0], prev = pages[0];
  for (const p of [...pages.slice(1), null]) {
    if (p === prev + 1) { prev = p; continue; }
    bits.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    start = prev = p;
  }
  return bits.join(", ");
};
