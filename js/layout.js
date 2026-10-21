// Rebuilding paragraphs from a PDF. A PDF doesn't store paragraphs, only pieces of text and
// where to draw them, so this works backwards from positions and sizes: pieces on the same
// baseline make a line, lines close together make a paragraph, and bigger or bold lines on
// their own become headings. No DOM, so the tests run it in Node.
//
// Input, per page: { width, height, items: [{ str, x, y, size, width, bold, italic }] }, with
// y measured down from the top of the page to the baseline, in points.

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const BULLET = /^\s*([•●▪◦‣∙·■□➢►✓✔-]|\*)\s+/;
const NUMBERED = /^\s*(\d{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,5})[.)]\s+/;
const PAGE_NUMBER = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

// Pieces of text on one baseline, split wherever there's a gap wide enough to be a column
// gutter or a table cell rather than a space.
function lines(page) {
  // blank pieces are dropped: spaces come back from the real gaps, and a blank piece spanning
  // a gap would glue two table cells together
  const items = page.items.filter((i) => i.str && i.str.trim() && i.size > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.min(r.size, it.size) * 0.4);
    if (row) { row.items.push(it); row.size = Math.max(row.size, it.size); }
    else rows.push({ y: it.y, size: it.size, items: [it] });
  }

  const out = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let seg = null;
    for (const it of row.items) {
      const gap = seg ? it.x - seg.x1 : 0;
      if (!seg || gap > Math.max(it.size, seg.size) * 1.5) {
        seg = { x0: it.x, x1: it.x + it.width, y: row.y, size: it.size, runs: [], page: page.index };
        out.push(seg);
      } else if (gap > it.size * 0.15 && !/\s$/.test(seg.runs.at(-1)?.text || "") && !/^\s/.test(it.str)) {
        addText(seg.runs, " ", it);
      }
      addText(seg.runs, it.str, it);
      seg.x1 = Math.max(seg.x1, it.x + it.width);
      seg.size = Math.max(seg.size, it.size);
    }
  }
  for (const s of out) {
    s.text = s.runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
    const chars = s.runs.reduce((n, r) => n + r.text.trim().length, 0) || 1;
    s.bold = s.runs.reduce((n, r) => n + (r.bold ? r.text.trim().length : 0), 0) / chars > 0.8;
  }
  return out.filter((s) => s.text);
}

function addText(runs, text, it) {
  const last = runs.at(-1);
  if (last && last.bold === !!it.bold && last.italic === !!it.italic) last.text += text;
  else runs.push({ text, bold: !!it.bold, italic: !!it.italic });
}

// Headers and footers repeat on most pages (digits aside, for page numbers and dates), so a
// line near the top or bottom that keeps coming back isn't part of the text.
function dropRepeats(pages) {
  const key = (s) => s.text.replace(/\d+/g, "#").toLowerCase();
  const edge = (s, p) => s.y < p.height * 0.1 || s.y > p.height * 0.9;
  const seen = new Map();
  for (const p of pages) for (const k of new Set(p.lines.filter((s) => edge(s, p)).map(key))) seen.set(k, (seen.get(k) || 0) + 1);
  const repeated = (k) => pages.length >= 2 && seen.get(k) >= Math.max(2, pages.length * 0.6);
  for (const p of pages) p.lines = p.lines.filter((s) => !(edge(s, p) && (repeated(key(s)) || PAGE_NUMBER.test(s.text))));
}

// Two-column pages: if lots of lines sit wholly in the left half and lots wholly in the right,
// read down the left column, then the right. Lines that span both (titles) split the page into
// bands that are read top to bottom.
function readingOrder(p) {
  const mid = p.width / 2, slack = p.width * 0.04;
  const side = (s) => (s.x1 <= mid + slack ? "L" : s.x0 >= mid - slack ? "R" : "S");
  const sides = p.lines.map(side);
  const left = sides.filter((x) => x === "L").length, right = sides.filter((x) => x === "R").length;
  const twoCol = right >= 5 && left >= 5 && right >= p.lines.length * 0.25 && left >= p.lines.length * 0.25;
  const byY = [...p.lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  if (!twoCol) return findTables(mergeRow(byY));

  const out = [];
  let band = [];
  const flush = () => {
    const l = band.filter((s) => side(s) === "L"), r = band.filter((s) => side(s) === "R");
    l.forEach((s) => (s.column = 0));
    r.forEach((s) => (s.column = 1));
    out.push(...l, ...r);
    band = [];
  };
  for (const s of byY) {
    if (side(s) === "S") { flush(); out.push(s); } else band.push(s);
  }
  flush();
  return out;
}

// On a one-column page, pieces split by a wide gap (a label and its value, a table row) go
// back on one line with a tab between them.
// Each piece is kept as a cell too, in case the rows turn out to be a table.
function mergeRow(byY) {
  const out = [];
  const cell = (s) => ({ x0: s.x0, x1: s.x1, text: s.text, runs: s.runs.map((r) => ({ ...r })) });
  for (const s of byY) {
    const prev = out.at(-1);
    if (prev && Math.abs(prev.y - s.y) <= Math.min(prev.size, s.size) * 0.4) {
      prev.runs.push({ text: "\t", bold: false, italic: false }, ...s.runs);
      prev.text += "\t" + s.text;
      prev.x1 = s.x1;
      prev.bold = prev.bold && s.bold;
      prev.cells.push(cell(s));
    } else out.push({ ...s, runs: [...s.runs], cells: [cell(s)] });
  }
  return out;
}

// Rows split into cells by wide gaps, two or more in a row and close together, whose cells
// line up in the same columns, are a table. Anything less regular stays as tab-separated text.
function findTables(rows) {
  const out = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j < rows.length && rows[j].cells.length >= 2 && (j === i || rows[j].y - rows[j - 1].y < rows[j].size * 3)) j++;
    const table = j - i >= 2 && asTable(rows.slice(i, j));
    if (table) { out.push(table); i = j; } else out.push(rows[i++]);
  }
  return out;
}

const NUMBER = /^[\s$€£(−-]*\d[\d,. ]*%?\)?$/;

function asTable(rows) {
  // columns are the x ranges the cells occupy; cells that overlap a column belong to it
  const slack = Math.max(...rows.map((r) => r.size));
  let cols = [];
  for (const r of rows) for (const c of r.cells) {
    const col = cols.find((k) => c.x0 < k.x1 + slack && c.x1 > k.x0 - slack);
    if (col) { col.x0 = Math.min(col.x0, c.x0); col.x1 = Math.max(col.x1, c.x1); } else cols.push({ x0: c.x0, x1: c.x1 });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  cols = cols.reduce((acc, c) => {               // growing columns can come to overlap; join those
    const last = acc.at(-1);
    if (last && c.x0 < last.x1) last.x1 = Math.max(last.x1, c.x1); else acc.push({ ...c });
    return acc;
  }, []);
  if (cols.length < 2) return null;

  const grid = [];
  for (const r of rows) {
    const cells = cols.map(() => null);
    for (const c of r.cells) {
      const k = cols.findIndex((col) => c.x0 < col.x1 + 1 && c.x1 > col.x0 - 1);
      if (k < 0 || cells[k]) return null;          // two cells in one column: not a grid
      cells[k] = c;
    }
    grid.push(cells);
  }
  // most of the grid should be filled, or it's scattered text rather than a table
  if (grid.flat().filter(Boolean).length < grid.length * cols.length * 0.6) return null;

  const numeric = cols.map((_, k) => {
    const body = grid.slice(1).map((r) => r[k]).filter(Boolean);
    return body.length > 0 && body.filter((c) => NUMBER.test(c.text)).length >= body.length * 0.6;
  });
  const first = rows[0], last = rows.at(-1);
  return {
    table: { rows: grid.map((r) => r.map((c) => (c ? c.runs : []))), widths: cols.map((c) => c.x1 - c.x0), numeric },
    page: first.page, y: first.y, size: first.size, x0: cols[0].x0, x1: cols.at(-1).x1, lastY: last.y, text: "", runs: [], bold: false,
  };
}

export function paragraphs(pagesIn) {
  const pages = pagesIn.map((p, index) => ({ ...p, index }));
  for (const p of pages) p.lines = lines(p);
  dropRepeats(pages);
  const ordered = pages.flatMap((p) => readingOrder(p).map((s) => ({ ...s, pageWidth: p.width })));
  if (!ordered.length) return [];

  // the body size is the one most of the characters are set in
  const sizeCount = new Map();
  for (const s of ordered) { const k = Math.round(s.size * 2) / 2; sizeCount.set(k, (sizeCount.get(k) || 0) + s.text.length); }
  const body = [...sizeCount].sort((a, b) => b[1] - a[1])[0][0];
  // and the usual distance between lines of body text
  const steps = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if (a.page === b.page && a.column === b.column && Math.abs(a.size - body) < 0.6 && Math.abs(b.size - body) < 0.6 && b.y > a.y) steps.push(b.y - a.y);
  }
  const leading = median(steps.filter((d) => d < body * 3)) || body * 1.25;
  // where lines of body text normally start and end, per page and column, to spot short lines
  const edges = new Map();
  for (const s of ordered) {
    const k = `${s.page}:${s.column ?? 0}`;
    const e = edges.get(k) || { left: [], right: [] };
    e.left.push(s.x0); e.right.push(s.x1);
    edges.set(k, e);
  }
  // a page with only a line or two can't say where its margin is, so use the whole document's
  const allRight = new Map();
  for (const s of ordered) allRight.set(s.column ?? 0, Math.max(allRight.get(s.column ?? 0) || 0, s.x1));
  const rightEdge = (s) => {
    const e = edges.get(`${s.page}:${s.column ?? 0}`);
    return e.right.length >= 3 ? Math.max(...e.right) : allRight.get(s.column ?? 0);
  };
  const leftEdge = (s) => { const e = edges.get(`${s.page}:${s.column ?? 0}`); return median(e.left); };

  const level = (s) => {
    const r = s.size / body;
    if (r >= 1.6) return 1;
    if (r >= 1.3) return 2;
    if (r >= 1.12) return 3;
    if (s.bold && s.text.length < 90 && !/[.,;:]$/.test(s.text) && r > 0.95) return 3;
    return 0;
  };

  const out = [];
  const sparse = (s) => edges.get(`${s.page}:${s.column ?? 0}`).right.length < 3;
  const isShort = (s) => s.x1 < rightEdge(s) - s.size * 4;
  // on a nearly empty page, a line that stops well short of the paper's right side ends its paragraph
  const endsPage = (s) => isShort(s) || (sparse(s) && s.column == null && s.x1 < s.pageWidth * 0.7);
  const isIndented = (s) => s.x0 > leftEdge(s) + s.size * 1.2;
  // some PDFs draw bullets as shapes, so a list can only be seen as a run of short lines
  // indented together
  const unmarked = (i) => {
    const s = ordered[i];
    if (!isShort(s) || !isIndented(s) || s.text.length > 120) return false;
    const near = (o) => o && o.page === s.page && o.column === s.column && Math.abs(o.x0 - s.x0) < s.size * 0.5 && isShort(o) && Math.abs(o.y - s.y) < leading * 1.6;
    return near(ordered[i - 1]) || near(ordered[i + 1]);
  };

  let cur = null, prev = null;
  for (const [i, s] of ordered.entries()) {
    if (s.table) {
      out.push({ table: s.table, page: s.page, top: s.y - s.size });
      cur = prev = null;                           // whatever comes next starts afresh
      continue;
    }
    const h = level(s);
    const marked = !h && (BULLET.test(s.text) || NUMBERED.test(s.text));
    const shapeBullet = !h && !marked && unmarked(i);
    const listStart = marked || shapeBullet;
    let fresh = !cur || !prev;
    if (!fresh) {
      const samePlace = s.page === prev.page && s.column === prev.column;
      const gap = s.y - prev.y;
      const endsSentence = /[.!?:"”)]$/.test(prev.text);
      const shortLine = isShort(prev);
      const indented = s.x0 > leftEdge(s) + s.size * 1.2 && !cur.list;
      fresh =
        h !== (cur.heading || 0) ||
        (h > 0) && !samePlace ||
        listStart ||
        Math.abs(s.size - prev.size) > body * 0.15 ||
        (samePlace && (gap > leading * 1.45 || gap < 0)) ||
        // the last line of a paragraph usually stops short of the margin
        (samePlace && shortLine) ||
        (indented && endsSentence) ||
        // across a page or column break, a full last line means the paragraph carries on
        (!samePlace && endsSentence && endsPage(prev)) ||
        // a list item's continuation lines are indented under its text
        (cur.list && s.x0 < cur.x0 + s.size * 0.5);
      // a heading only runs on if the lines are right under each other
      if (!fresh && h > 0 && gap > s.size * 1.6) fresh = true;
    }

    if (fresh) {
      cur = { heading: h || undefined, list: listStart || undefined, runs: [], x0: s.x0, page: s.page, top: s.y - s.size };
      if (shapeBullet) s.runs.unshift({ text: "•\t", bold: false, italic: false });
      else if (listStart) {
        const m = s.text.match(BULLET);
        if (m) { s.runs[0].text = s.runs[0].text.trimStart(); trimStart(s.runs, m[0].trimStart().length, "•\t"); }
        else s.runs[0].text = s.runs[0].text.trimStart().replace(NUMBERED, (_, n) => `${n}.\t`);
      }
      out.push(cur);
      cur.runs.push(...s.runs.map((r) => ({ ...r })));
    } else {
      const last = cur.runs.at(-1);
      // "infor-" + "mation" -> "information"; anything else gets a space
      if (last && /[a-z]-$/i.test(last.text.trimEnd()) && /^[a-z]/.test(s.text)) last.text = last.text.trimEnd().slice(0, -1);
      else if (last) last.text = last.text.trimEnd() + " ";
      cur.runs.push(...s.runs.map((r) => ({ ...r })));
    }
    prev = s;
  }

  // tidy runs: join neighbours with the same style, squeeze spaces
  for (const p of out) {
    if (p.table) continue;
    const merged = [];
    for (const r of p.runs) {
      const last = merged.at(-1);
      if (last && last.bold === r.bold && last.italic === r.italic) last.text += r.text;
      else merged.push({ ...r });
    }
    merged.forEach((r) => (r.text = r.text.replace(/ {2,}/g, " ")));
    if (merged.length) { merged[0].text = merged[0].text.trimStart(); merged.at(-1).text = merged.at(-1).text.trimEnd(); }
    p.runs = merged.filter((r) => r.text);
    delete p.x0;
  }
  return out.filter((p) => p.table || p.runs.length);
}

// Cuts the first `n` characters off a run list and puts `lead` in front.
function trimStart(runs, n, lead) {
  let left = n;
  while (left > 0 && runs.length) {
    const r = runs[0];
    if (r.text.length <= left) { left -= r.text.length; runs.shift(); }
    else { r.text = r.text.slice(left); left = 0; }
  }
  runs.unshift({ text: lead, bold: false, italic: false });
}

// Puts pictures among the paragraphs by page and height. Pictures that are really a scanned
// page behind its own text, or a logo repeated in every page's header or footer, are left out.
// pictures: [{ page, x, y, width, height, key, ... }] in the same top-down points as the text.
export function withPictures(paras, pictures, pages) {
  const texty = new Set(paras.map((p) => p.page));
  const edge = (pic) => { const p = pages[pic.page]; return pic.y + pic.height < p.height * 0.15 || pic.y > p.height * 0.85; };
  const repeats = new Map();
  for (const pic of pictures) if (edge(pic)) repeats.set(pic.key, new Set([...(repeats.get(pic.key) || []), pic.page]));
  const keep = pictures.filter((pic) => {
    const p = pages[pic.page];
    if (texty.has(pic.page) && pic.width * pic.height > p.width * p.height * 0.85) return false;
    if (edge(pic) && pages.length >= 2 && repeats.get(pic.key).size >= Math.max(2, pages.length * 0.6)) return false;
    return true;
  }).sort((a, b) => a.page - b.page || a.y - b.y);

  const out = [];
  let i = 0;
  for (const para of paras) {
    while (i < keep.length && (keep[i].page < para.page || (keep[i].page === para.page && keep[i].y < para.top))) { out.push({ picture: keep[i], page: keep[i].page }); i++; }
    out.push(para);
  }
  while (i < keep.length) out.push({ picture: keep[i], page: keep[i++].page });
  return out;
}
