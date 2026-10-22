// Loading, reading and redrawing PDFs. pdf-lib edits files; pdf.js reads and draws them.
// Both are served from vendor/ and only loaded when a tool first needs them.

let pdfLib, pdfjs;

export async function lib() {
  pdfLib ??= await import("../vendor/pdf-lib/pdf-lib.esm.min.js");
  return pdfLib;
}

export async function viewer() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

// A picked or dropped file's bytes. The browser only holds a pointer to the file on disk, so
// reading fails if the file changed, moved or isn't fully on the disk since it was chosen:
// overwritten by a new download, renamed, or still syncing from iCloud or OneDrive.
export async function readBytes(file) {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    throw unreadable(file, err);
  }
}

export function unreadable(file, err) {
  if (!/NotReadable|NotFound|Security/.test(err?.name || "")) return err;
  return new Error(`${file.name} couldn't be read from your disk. That happens when a file changes, moves or is still downloading (or syncing from iCloud) after you choose it. Choose it again from Finder or File Explorer.`);
}

// A pdf-lib document, with a plain-words error for locked files.
// pdf-lib is strict: it refuses files that open fine elsewhere, like ones "secured" against
// editing (encrypted, but with no password needed to open them) or ones with a slightly broken
// structure. Those are rebuilt with qpdf first, which copes with far more. The rebuilt bytes
// are remembered, so a tool that opens the same file again doesn't redo it.
const rebuilt = new WeakMap();
export async function openForEdit(bytes) {
  const { PDFDocument } = await lib();
  const load = (b) => PDFDocument.load(b, { updateMetadata: false });
  if (rebuilt.has(bytes)) return load(rebuilt.get(bytes));
  try {
    return await load(bytes);
  } catch (err) {
    const { qpdf } = await import("./qpdf.js");
    let fixed;
    try {
      // tries opening with no password; fails only if one is really needed to open it
      fixed = await qpdf(bytes, /encrypt/i.test(err.message) ? ["--decrypt"] : []);
    } catch (qerr) {
      if (/encrypt/i.test(err.message) || qerr.badPassword) throw new Error("This PDF is password-protected.");
      console.warn("pdf-lib:", err.message, "| qpdf:", qerr.message);
      throw new Error("This PDF's structure is too damaged to read. Try Repair PDF on it first.");
    }
    const doc = await load(fixed).catch((again) => {
      console.warn("pdf-lib after qpdf:", again.message);
      throw new Error("This PDF's structure is too damaged to read. Try Repair PDF on it first.");
    });
    rebuilt.set(bytes, fixed);
    return doc;
  }
}

// A pdf.js document, for drawing pages and reading text. pdf.js takes ownership of the
// buffer it's given, so it gets a copy and the caller keeps the original.
export async function openForView(bytes, password) {
  const { getDocument } = await viewer();
  return getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
}

// Draws one page (1-based) onto a new canvas, `width` pixels wide or at `scale`.
export async function drawPage(doc, number, { width, scale } = {}) {
  const page = await doc.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: scale ?? width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport, page };
}

export const canvasBlob = (canvas, type = "image/jpeg", quality = 0.85) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// All the text on each page, as pdf.js reads it.
export async function pageTexts(doc) {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let text = "", lastY = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
      else if (text && !text.endsWith(" ") && item.str && !item.str.startsWith(" ")) text += " ";
      text += item.str;
      lastY = y;
    }
    out.push(text.replace(/[ \t]+\n/g, "\n").trim());
  }
  return out;
}

// Rebuilds a PDF with some (or all) pages turned into pictures. Used where the page's
// contents must really change: redaction (black boxes burned in, text gone), grayscale,
// and strong compression. Pages not in `which` are copied across untouched.
export async function rasterize(bytes, { which, scale = 2, quality = 0.85, gray = false, boxes = {}, onPage } = {}) {
  const { PDFDocument } = await lib();
  const src = await openForEdit(bytes);
  const view = await openForView(bytes);
  const out = await PDFDocument.create();
  const all = which ?? new Set(src.getPageIndices());

  for (let i = 0; i < src.getPageCount(); i++) {
    onPage?.(i + 1, src.getPageCount());
    if (!all.has(i)) {
      const [copy] = await out.copyPages(src, [i]);
      out.addPage(copy);
      continue;
    }
    const { canvas, viewport } = await drawPage(view, i + 1, { scale });
    const ctx = canvas.getContext("2d");
    if (gray) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let p = 0; p < d.length; p += 4) {
        const y = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
        d[p] = d[p + 1] = d[p + 2] = y;
      }
      ctx.putImageData(img, 0, 0);
    }
    // boxes are fractions of the page (0..1), so they don't depend on the drawing size
    ctx.fillStyle = "#000";
    for (const b of boxes[i] || []) ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);

    const jpg = new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer());
    const image = await out.embedJpg(jpg);
    const size = src.getPage(i).getSize();
    // the drawn page is already rotated the way it's shown, so the new page is laid out upright
    const rotated = viewport.rotation % 180 !== 0;
    const w = rotated ? size.height : size.width, hgt = rotated ? size.width : size.height;
    const page = out.addPage([w, hgt]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: hgt });
  }
  await view.destroy();
  return out.save();
}

// Where to draw something so it looks upright on the page as people see it, even when the
// page has a /Rotate set. `rect` is in fractions (0..1) of the page as shown; pdf.js's
// viewport converts that view back to the page's own coordinates.
export function uprightRect(viewport, rect) {
  const [x1, y1] = viewport.convertToPdfPoint(rect.x * viewport.width, rect.y * viewport.height);
  const [x2, y2] = viewport.convertToPdfPoint((rect.x + rect.w) * viewport.width, (rect.y + rect.h) * viewport.height);
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const w = maxX - minX, hgt = maxY - minY;
  switch (((viewport.rotation % 360) + 360) % 360) {
    case 90: return { x: maxX, y: minY, width: hgt, height: w, rotate: 90 };
    case 180: return { x: maxX, y: maxY, width: w, height: hgt, rotate: 180 };
    case 270: return { x: minX, y: maxY, width: hgt, height: w, rotate: 270 };
    default: return { x: minX, y: minY, width: w, height: hgt, rotate: 0 };
  }
}

// A point given in view fractions, in page coordinates, plus the turn text needs to read upright.
export function uprightPoint(viewport, fx, fy) {
  const [x, y] = viewport.convertToPdfPoint(fx * viewport.width, fy * viewport.height);
  return { x, y, rotate: ((viewport.rotation % 360) + 360) % 360 };
}

// One scale-1 viewport per page, for placing things.
export async function viewports(viewDoc) {
  const out = [];
  for (let i = 1; i <= viewDoc.numPages; i++) out.push((await viewDoc.getPage(i)).getViewport({ scale: 1 }));
  return out;
}
