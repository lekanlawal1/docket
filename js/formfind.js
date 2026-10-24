// Finding the places to write on a form that has no form fields: a scan, a photo, or a PDF
// made from a picture. It looks at the drawn page the way a person would:
//  - a line with nothing written above it is a blank to write on;
//  - a small empty square is a tick box.
// Works on { data, width, height } (RGBA, like ImageData) so the tests run in Node.
// Results are in fractions of the page (0..1), top-left origin.

const DARK = 185;   // faint grey rules on scanned forms still count

function darkMask({ data, width: w, height: h }) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2] < DARK ? 1 : 0;
  return m;
}

// Share of dark pixels in a box (clamped to the page).
function ink(m, w, h, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
  if (x1 <= x0 || y1 <= y0) return 1;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += m[y * w + x];
  return n / ((x1 - x0) * (y1 - y0));
}

// Horizontal strokes: dark runs at least `minLen` long in a row (tiny gaps bridged, as scans
// and dotted underscores have them), then stacked rows merged into one stroke.
function horizontalStrokes(m, w, h, minLen) {
  const runs = [];
  for (let y = 0; y < h; y++) {
    let start = -1, gap = 0;
    for (let x = 0; x <= w; x++) {
      const on = x < w && m[y * w + x];
      if (on) { if (start < 0) start = x; gap = 0; }
      else if (start >= 0) {
        if (++gap > 3 || x === w) {
          const end = x - gap;
          if (end - start + 1 >= minLen) runs.push({ x0: start, x1: end, y });
          start = -1; gap = 0;
        }
      }
    }
  }
  // merge runs in neighbouring rows that overlap mostly
  const strokes = [];
  for (const r of runs) {
    const s = strokes.find((s) => r.y - s.y1 <= 1 && r.y >= s.y0 && Math.min(r.x1, s.x1) - Math.max(r.x0, s.x0) > 0.6 * Math.min(r.x1 - r.x0, s.x1 - s.x0));
    if (s) { s.y1 = r.y; s.x0 = Math.min(s.x0, r.x0); s.x1 = Math.max(s.x1, r.x1); }
    else strokes.push({ x0: r.x0, x1: r.x1, y0: r.y, y1: r.y });
  }
  return strokes;
}

// Is there a vertical stroke through (x, y), as at the side of a table cell?
function verticalAt(m, w, h, x, y, reach) {
  for (let dx = -3; dx <= 3; dx++) {
    const xx = x + dx;
    if (xx < 0 || xx >= w) continue;
    let up = 0, down = 0;
    for (let k = 1; k <= reach && y - k >= 0 && m[(y - k) * w + xx]; k++) up++;
    for (let k = 1; k <= reach && y + k < h && m[(y + k) * w + xx]; k++) down++;
    if (up >= reach * 0.8 || down >= reach * 0.8) return true;
  }
  return false;
}

export function findBlanks(img) {
  const { width: w, height: h } = img;
  const m = darkMask(img);
  const unit = w / 100;                      // 1% of the page width
  const fieldH = 1.8 * unit;                 // room for one line of text, about 11 pt on Letter

  // ---- lines to write on
  const lines = [];
  for (const s of horizontalStrokes(m, w, h, 3.2 * unit)) {
    const thick = s.y1 - s.y0 + 1;
    if (thick > 0.3 * unit) continue;                                   // a heavy rule or a filled bar: write-on lines are thin
    const len = s.x1 - s.x0;
    if (len > 0.9 * w) continue;                                        // a page-wide rule
    // the side of a table: a vertical stroke at either end
    if (verticalAt(m, w, h, s.x0, s.y0, 1.5 * unit) && verticalAt(m, w, h, s.x1, s.y0, 1.5 * unit)) continue;
    // the top or bottom edge of a word in bold type: letters touch it all along
    let touching = 0;
    for (let x = s.x0; x <= s.x1; x++) touching += (m[Math.max(0, s.y0 - 2) * w + x] | m[Math.min(h - 1, s.y1 + 2) * w + x]);
    if (touching / (len + 1) > 0.2) continue;
    // where the space just above is free: label text above part of the line splits it into blanks
    const near = s.y0 - 1.1 * unit, bottom = s.y0 - 0.2 * unit;
    let runStart = -1, lastInk = -Infinity;
    const free = [];
    for (let x = s.x0; x <= s.x1 + 1; x++) {
      const colInk = x <= s.x1 && ink(m, w, h, x, near, x + 1, bottom) > 0;
      if (colInk) lastInk = x;
      const clear = x <= s.x1 && x - lastInk > 0.6 * unit;
      if (clear && runStart < 0) runStart = x;
      if (!clear && runStart >= 0) { free.push([runStart, x - 1]); runStart = -1; }
    }
    for (const [a, b] of free) {
      if (b - a < 3 * unit) continue;
      // as tall as the room allows, up to a full line: on tightly spaced forms the label above sits close
      let top = s.y0 - fieldH;
      for (let y = Math.round(near); y >= s.y0 - fieldH; y--) if (ink(m, w, h, a, y, b + 1, y + 1) > 0.02) { top = y + 1; break; }
      if (s.y0 - top < 1.0 * unit) continue;
      lines.push({ kind: "text", x: a / w, y: top / h, w: (b - a) / w, h: (s.y0 - top) / h });
    }
  }

  // ---- tick boxes: small, square, hollow outlines with all four corners drawn
  const label = new Int32Array(w * h), boxes = [];
  const stack = [];
  let next = 0;
  for (let p = 0; p < w * h; p++) {
    if (!m[p] || label[p]) continue;
    next++;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, count = 0;
    stack.push(p); label[p] = next;
    while (stack.length) {
      const q = stack.pop(), qx = q % w, qy = (q - qx) / w;
      count++;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      if (x1 - x0 > 5 * unit || y1 - y0 > 5 * unit) { /* too big to be a box: keep labelling, judge later */ }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (m[r] && !label[r]) { label[r] = next; stack.push(r); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 0.7 * unit || bh < 0.7 * unit || bw > 2.6 * unit || bh > 2.6 * unit) continue;
    if (Math.abs(bw - bh) > 0.25 * Math.max(bw, bh)) continue;
    // hollow: the middle is empty, the outline is mostly drawn, and so are the corners
    const inset = Math.max(2, Math.round(bw * 0.22));
    if (ink(m, w, h, x0 + inset, y0 + inset, x1 - inset + 1, y1 - inset + 1) > 0.08) continue;
    // each of the four sides mostly drawn (letters like D or E fail one side)
    const side = (len, at) => { let n = 0; for (let k = 0; k < len; k++) n += m[at(k)]; return n / len; };
    const sides = [side(bw, (k) => y0 * w + x0 + k), side(bw, (k) => y1 * w + x0 + k), side(bh, (k) => (y0 + k) * w + x0), side(bh, (k) => (y0 + k) * w + x1)];
    if (sides.some((v) => v < 0.8)) continue;
    boxes.push({ kind: "check", x: x0 / w, y: y0 / h, w: bw / w, h: bh / h });
  }

  // a stroke that's really the bottom of a tick box isn't a line to write on
  const fields = lines.filter((l) => !boxes.some((b) => Math.abs((l.y + l.h) - (b.y + b.h)) < 0.01 && l.x >= b.x - 0.005 && l.x + l.w <= b.x + b.w + 0.005));
  return [...fields, ...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
}
