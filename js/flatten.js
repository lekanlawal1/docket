// Flattening: form answers, comments, highlights, stamps and drawings become part of the page
// itself, so they look the same everywhere and can't be changed or lost.
//
// pdf-lib flattens form fields. Other marks are drawn here from their own stored look (the
// "appearance stream" every PDF app saves alongside a comment), placed exactly where a viewer
// would show it, and then removed as annotations.

import { lib } from "./pdf.js";

const HIDDEN = 2, NO_VIEW = 32;
// these aren't marks on the page: links stay clickable, pop-ups are the comment's text box
const KEEP = new Set(["Link"]);
const DROP = new Set(["Popup"]);

// What's on each page that would be flattened, without changing anything.
export async function survey(doc) {
  const { PDFName, PDFDict } = await lib();
  let fields = 0;
  try { fields = doc.getForm().getFields().length; } catch { /* a broken form counts as none */ }
  const kinds = {}, noLook = [];
  doc.getPages().forEach((page, i) => {
    for (const a of annots(page, PDFDict)) {
      const type = a.lookup(PDFName.of("Subtype"))?.asString().slice(1) || "Unknown";
      if (KEEP.has(type) || DROP.has(type) || type === "Widget") continue;
      kinds[type] = (kinds[type] || 0) + 1;
      if (!appearance(a, PDFName, PDFDict)) noLook.push(i + 1);
    }
  });
  return { fields, kinds, marks: Object.values(kinds).reduce((n, k) => n + k, 0), noLook: [...new Set(noLook)] };
}

// The page's annotations, each with the reference it's stored under (to keep some).
function annots(page, PDFDict) {
  const arr = page.node.Annots();
  if (!arr) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i++) {
    const a = arr.lookup(i);
    if (a instanceof PDFDict) { a.raw = arr.get(i); out.push(a); }
  }
  return out;
}

// The stream that draws an annotation as it normally looks, or null.
function appearance(a, PDFName, PDFDict) {
  const ap = a.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return null;
  const nRaw = ap.get(PDFName.of("N"));
  const n = ap.lookup(PDFName.of("N"));
  // a dictionary of looks (a checkbox's on and off) is picked by the annotation's state
  if (n instanceof PDFDict) {
    const state = a.lookup(PDFName.of("AS"));
    const stream = state && n.lookup(state);
    return stream?.dict ? { ref: n.get(state), stream } : null;
  }
  return n?.dict ? { ref: nRaw, stream: n } : null;
}

const nums = (arr) => (arr ? arr.asArray().map((v) => v.asNumber()) : null);

// Flattens `doc` in place. Returns what was done.
export async function flattenDoc(doc) {
  const ops = await lib();
  const { PDFName, PDFDict, PDFRef } = ops;
  const done = { fields: 0, drawn: 0, removed: 0, kept: 0 };

  // form fields first: pdf-lib redraws each answer and puts it on the page
  try {
    const form = doc.getForm();
    done.fields = form.getFields().length;
    if (done.fields) {
      try { form.flatten(); }
      catch { form.flatten({ updateFieldAppearances: false }); }   // answers with characters it can't redraw keep their saved look
    }
  } catch { done.fields = 0; }

  let n = 0;
  for (const page of doc.getPages()) {
    if (!page.node.Annots()) continue;
    const keep = [];
    const draw = [];
    for (const a of annots(page, PDFDict)) {
      const type = a.lookup(PDFName.of("Subtype"))?.asString().slice(1);
      const flags = a.lookup(PDFName.of("F"))?.asNumber() || 0;
      if (KEEP.has(type)) { keep.push(a); done.kept++; continue; }
      done.removed++;
      if (DROP.has(type) || flags & (HIDDEN | NO_VIEW)) continue;
      const look = appearance(a, PDFName, PDFDict);
      const rect = nums(a.lookup(PDFName.of("Rect")));
      if (!look || !rect) continue;
      const stream = look.stream;
      const bbox = nums(stream.dict.lookup(PDFName.of("BBox")));
      if (!bbox) continue;
      const m = nums(stream.dict.lookup(PDFName.of("Matrix"))) || [1, 0, 0, 1, 0, 0];
      // where the appearance's box lands after its own matrix (PDF spec, 12.5.5)
      const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const tx0 = Math.min(...pts.map((p) => p[0])), tx1 = Math.max(...pts.map((p) => p[0]));
      const ty0 = Math.min(...pts.map((p) => p[1])), ty1 = Math.max(...pts.map((p) => p[1]));
      if (tx1 - tx0 <= 0 || ty1 - ty0 <= 0) continue;
      const rx0 = Math.min(rect[0], rect[2]), ry0 = Math.min(rect[1], rect[3]);
      const sx = (Math.abs(rect[2] - rect[0])) / (tx1 - tx0), sy = (Math.abs(rect[3] - rect[1])) / (ty1 - ty0);
      // an appearance has to be a form XObject to be drawn with Do; many omit the labels
      stream.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
      stream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
      const ref = look.ref instanceof PDFRef ? look.ref : doc.context.register(stream);
      const name = page.node.newXObject(`Flat${n++}`, ref);
      draw.push([sx, sy, rx0 - tx0 * sx, ry0 - ty0 * sy, name]);
    }
    // pdf-lib wraps the page's own content in q/Q first, so a drawing state it leaves changed
    // doesn't move these
    if (draw.length) {
      page.pushOperators(...draw.flatMap(([a, d, e, f, name]) => [ops.pushGraphicsState(), ops.concatTransformationMatrix(a, 0, 0, d, e, f), ops.drawObject(name), ops.popGraphicsState()]));
      done.drawn += draw.length;
    }
    if (keep.length) page.node.set(PDFName.of("Annots"), doc.context.obj(keep.map((a) => a.raw)));
    else page.node.delete(PDFName.of("Annots"));
  }
  return done;
}
