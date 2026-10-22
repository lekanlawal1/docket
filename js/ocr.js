// Reading text from page images with Tesseract, then laying it into the PDF as invisible
// text so the page looks the same but can be searched, selected and copied.
// Tesseract and its English data are about 7 MB, fetched the first time this runs; French adds
// under 1 MB more, only when it's chosen.

import { lib, drawPage, uprightPoint } from "./pdf.js";

const here = (path) => new URL(`../vendor/tesseract/${path}`, import.meta.url).href;
const starting = new Map();

// One worker per language choice ("eng", "fra" or "eng+fra"), kept for the session: starting
// one is the slow part.
export function reader(onProgress, langs = "eng") {
  if (!starting.has(langs)) starting.set(langs, (async () => {
    const { default: Tesseract } = await import("../vendor/tesseract/tesseract.esm.min.js");
    return Tesseract.createWorker(langs, 1, {
      workerPath: here("worker.min.js"),
      corePath: here("core"),
      langPath: here("lang"),
      gzip: true,
      logger: (m) => reader.listener?.(m),
    });
  })().catch((err) => { starting.delete(langs); throw err; }));
  reader.listener = onProgress;
  return starting.get(langs);
}

// Reads `canvas`, and if it reads as nonsense (scanned sideways or upside down), tries the other
// ways round and keeps the best. Text read the wrong way comes out as lots of one-character
// "words" at middling confidence, so only confident, word-like results count.
export async function readAnyWayUp(worker, canvas) {
  const read = async (turn) => {
    const { data } = await worker.recognize(turn ? turned(canvas, turn) : canvas);
    const found = data.words.filter((w) => w.text.trim() && w.confidence > 20);
    const score = found.filter((w) => w.confidence >= 75 && /\p{L}{3}|\d{2}/u.test(w.text)).length;
    return { data, found, turn, score };
  };
  let best = await read(0);
  for (const turn of [90, 270, 180]) {
    if (best.score >= 10 && best.data.confidence >= 70) break;
    const attempt = await read(turn);
    if (attempt.score > best.score) best = attempt;
  }
  return best;
}

// Draws page `number` (1-based) sharp enough to read, about 300 dpi, capped so a huge page
// doesn't run a phone out of memory.
export async function pageForReading(viewDoc, number) {
  const page = await viewDoc.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(300 / 72, 3500 / Math.max(base.width, base.height));
  return drawPage(viewDoc, number, { scale });
}

// Helvetica only covers Western European characters; anything else is simplified or dropped
// rather than failing the whole page.
function encodable(font, word) {
  try { font.encodeText(word); return word; }
  catch {
    const plain = word.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
    return plain || null;
  }
}

const fonts = new WeakMap();

// A copy of `canvas` turned clockwise by `turn` degrees (90, 180 or 270).
export function turned(canvas, turn) {
  const side = turn % 180 !== 0;
  const out = Object.assign(document.createElement("canvas"), { width: side ? canvas.height : canvas.width, height: side ? canvas.width : canvas.height });
  const ctx = out.getContext("2d");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

// A point on the turned copy, back on the original page drawing (W × H pixels).
function unturn(u, v, turn, W, H) {
  if (turn === 90) return [v, H - u];
  if (turn === 180) return [W - u, H - v];
  if (turn === 270) return [W - v, u];
  return [u, v];
}

// Adds `words` (from Tesseract, in pixels of `viewport`, or of a copy turned by `turn`) to
// `page` as invisible text.
export async function addTextLayer(doc, page, words, viewport, turn = 0) {
  const ops = await lib();
  if (!fonts.has(doc)) fonts.set(doc, await doc.embedFont(ops.StandardFonts.Helvetica));
  const font = fonts.get(doc);
  const key = page.node.newFontDictionary(font.name, font.ref);
  const s = viewport.scale;
  const list = [ops.pushGraphicsState(), ops.beginText(), ops.setTextRenderingMode(ops.TextRenderingMode.Invisible)];
  let added = 0;

  for (const w of words) {
    const text = encodable(font, w.text.trim());
    if (!text) continue;
    const { x0, y0, x1, y1 } = w.bbox;
    const width = (x1 - x0) / s, height = (y1 - y0) / s;
    if (width <= 0 || height <= 0) continue;
    const size = Math.max(1, height);
    // start at the word's left edge, a fifth of the way up from the bottom (roughly the baseline)
    const [px, py] = unturn(x0, y1 - (y1 - y0) * 0.2, turn, viewport.width, viewport.height);
    const at = uprightPoint(viewport, px / viewport.width, py / viewport.height);
    const natural = font.widthOfTextAtSize(text + " ", size);
    // text read on a copy turned clockwise runs anticlockwise by the same amount on the page
    const angle = ((at.rotate + turn) * Math.PI) / 180;
    list.push(
      ops.setFontAndSize(key, size),
      // squeeze or stretch so the word, plus its trailing space, covers the word on the page
      ops.setCharacterSqueeze((100 * (width + size * 0.25)) / natural),
      ops.rotateAndSkewTextRadiansAndTranslate(angle, 0, 0, at.x, at.y),
      ops.showText(font.encodeText(text + " ")),
    );
    added++;
  }
  list.push(ops.endText(), ops.popGraphicsState());
  if (added) page.pushOperators(...list);
  return added;
}
