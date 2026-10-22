// Cleaning a PDF before it's shared: finding, and removing, what a file carries besides its
// pages. Document details, comments, attached files, scripts, hidden layers and earlier saved
// versions all travel with a PDF without showing on the page.

import { lib } from "./pdf.js";

const MARKS_KEPT = new Set(["Link", "Widget"]);
// actions that run something, send something or open something outside the document
const RISKY = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "GoToR", "GoToE", "Rendition", "Movie", "Sound"]);

const name = (v) => v?.asString?.().slice(1);
const text = (v) => (v?.decodeText ? v.decodeText() : v?.asString ? v.asString() : "");

function annotsOf(page, L) {
  const arr = page.node.Annots();
  if (!arr) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i++) { const a = arr.lookup(i); if (a instanceof L.PDFDict) out.push({ dict: a, raw: arr.get(i) }); }
  return out;
}

// The leaves of a name tree (EmbeddedFiles, JavaScript): [key, value] pairs.
function leaves(tree, L, out = []) {
  if (!(tree instanceof L.PDFDict)) return out;
  const names = tree.lookup(L.PDFName.of("Names"));
  if (names instanceof L.PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) out.push([text(names.lookup(i)), names.lookup(i + 1)]);
  const kids = tree.lookup(L.PDFName.of("Kids"));
  if (kids instanceof L.PDFArray) for (let i = 0; i < kids.size(); i++) leaves(kids.lookup(i), L, out);
  return out;
}

// Every place an action can hide: a dictionary's /A and its /AA (automatic actions).
function actions(dict, L) {
  const found = [];
  const a = dict.lookup(L.PDFName.of("A"));
  if (a instanceof L.PDFDict) found.push(name(a.lookup(L.PDFName.of("S"))));
  const aa = dict.lookup(L.PDFName.of("AA"));
  if (aa instanceof L.PDFDict) for (const [, v] of aa.entries()) { const d = aa.context.lookup(v); if (d instanceof L.PDFDict) found.push(name(d.lookup(L.PDFName.of("S")))); }
  return found;
}

// What's in the file, without changing it. `bytes` are the file as it was opened.
export async function inspect(doc, bytes) {
  const L = await lib();
  const N = (s) => L.PDFName.of(s);
  const cat = doc.catalog;
  const out = { details: {}, xmp: false, comments: [], attachments: [], scripts: 0, links: 0, hiddenLayers: [], versions: 0, appData: 0 };

  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof L.PDFDict) for (const [k, v] of info.entries()) { const t = text(doc.context.lookup(v)); if (t) out.details[k.asString().slice(1)] = t; }
  out.xmp = !!cat.get(N("Metadata"));

  const names = cat.lookup(N("Names"));
  if (names instanceof L.PDFDict) {
    for (const [file] of leaves(names.lookup(N("EmbeddedFiles")), L)) out.attachments.push(file);
    out.scripts += leaves(names.lookup(N("JavaScript")), L).length;
  }
  const open = cat.lookup(N("OpenAction"));
  if (open instanceof L.PDFDict && RISKY.has(name(open.lookup(N("S"))))) out.scripts++;
  out.scripts += actions(cat, L).filter((s) => RISKY.has(s)).length;
  if (cat.get(N("PieceInfo"))) out.appData++;

  for (const page of doc.getPages()) {
    out.scripts += actions(page.node, L).filter((s) => RISKY.has(s)).length;
    if (page.node.get(N("PieceInfo")) || page.node.get(N("Metadata")) || page.node.get(N("Thumb"))) out.appData++;
    for (const { dict } of annotsOf(page, L)) {
      const type = name(dict.lookup(N("Subtype")));
      const acts = actions(dict, L);
      out.scripts += acts.filter((s) => RISKY.has(s)).length;
      if (type === "Link") { if (acts.includes("URI")) out.links++; continue; }
      if (type === "FileAttachment") { const fs = dict.lookup(N("FS")); out.attachments.push((fs instanceof L.PDFDict && text(fs.lookup(N("UF")) || fs.lookup(N("F")))) || "attached file"); continue; }
      if (MARKS_KEPT.has(type) || type === "Popup") continue;
      out.comments.push({ type, text: text(dict.lookup(N("Contents"))) });
    }
  }

  // layers switched off by default: their content is in the file, just not drawn
  const oc = cat.lookup(N("OCProperties"));
  const off = oc instanceof L.PDFDict && oc.lookup(N("D"))?.lookup?.(N("OFF"));
  if (off instanceof L.PDFArray) for (let i = 0; i < off.size(); i++) { const g = off.lookup(i); out.hiddenLayers.push((g instanceof L.PDFDict && text(g.lookup(N("Name")))) || "unnamed layer"); }

  // every save that added to the file instead of rewriting it leaves the old version inside;
  // a fast-web-view file has one extra end marker by design
  const raw = new TextDecoder("latin1").decode(bytes);
  out.versions = Math.max(0, (raw.match(/%%EOF/g) || []).length - 1 - (/\/Linearized/.test(raw.slice(0, 2048)) ? 1 : 0));
  return out;
}

// Removes what `what` asks for from `doc`, in place, then drops every object nothing refers to
// any more (pdf-lib would otherwise save those too, removed comments and all).
export async function clean(doc, what) {
  const L = await lib();
  const N = (s) => L.PDFName.of(s);
  const cat = doc.catalog;

  if (what.details) {
    doc.context.trailerInfo.Info = undefined;
    cat.delete(N("Metadata"));
    cat.delete(N("PieceInfo"));
    for (const page of doc.getPages()) for (const k of ["PieceInfo", "Metadata", "Thumb"]) page.node.delete(N(k));
  }
  if (what.attachments) {
    const names = cat.lookup(N("Names"));
    if (names instanceof L.PDFDict) names.delete(N("EmbeddedFiles"));
    cat.delete(N("AF"));
  }
  if (what.scripts) {
    const names = cat.lookup(N("Names"));
    if (names instanceof L.PDFDict) names.delete(N("JavaScript"));
    const open = cat.lookup(N("OpenAction"));
    if (open instanceof L.PDFDict && RISKY.has(name(open.lookup(N("S"))))) cat.delete(N("OpenAction"));
    cat.delete(N("AA"));
  }
  for (const page of doc.getPages()) {
    if (what.scripts) page.node.delete(N("AA"));
    const list = annotsOf(page, L);
    if (!list.length) continue;
    const keep = [];
    for (const { dict, raw } of list) {
      const type = name(dict.lookup(N("Subtype")));
      const acts = actions(dict, L);
      if (what.scripts) {
        dict.delete(N("AA"));
        if (acts.some((s) => RISKY.has(s))) { dict.delete(N("A")); if (type === "Link") continue; }
      }
      if (type === "Link") { if (what.links && acts.includes("URI")) continue; keep.push(raw); continue; }
      if (type === "Widget") { keep.push(raw); continue; }
      if (type === "FileAttachment") { if (!what.attachments) keep.push(raw); continue; }
      if (!what.comments) keep.push(raw);
    }
    if (keep.length) page.node.set(N("Annots"), doc.context.obj(keep));
    else page.node.delete(N("Annots"));
  }
  if (what.scripts) {
    // form fields can carry scripts too (run on typing, on leaving the box, and so on)
    const form = cat.lookup(N("AcroForm"));
    const walk = (arr) => { if (!(arr instanceof L.PDFArray)) return; for (let i = 0; i < arr.size(); i++) { const f = arr.lookup(i); if (f instanceof L.PDFDict) { f.delete(N("AA")); walk(f.lookup(N("Kids"))); } } };
    if (form instanceof L.PDFDict) walk(form.lookup(N("Fields")));
  }
  return sweep(doc, L);
}

// Mark everything reachable from the document's root, delete the rest. Returns how many went.
function sweep(doc, L) {
  const ctx = doc.context, seen = new Set();
  const visit = (obj) => {
    if (!obj) return;
    if (obj instanceof L.PDFRef) {
      if (seen.has(obj.tag)) return;
      seen.add(obj.tag);
      return visit(ctx.lookup(obj));
    }
    if (obj instanceof L.PDFDict) for (const [, v] of obj.entries()) visit(v);
    else if (obj instanceof L.PDFArray) for (const v of obj.asArray()) visit(v);
    else if (obj.dict instanceof L.PDFDict) visit(obj.dict);     // a stream
  };
  visit(ctx.trailerInfo.Root);
  visit(ctx.trailerInfo.Info);
  let gone = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); gone++; }
  return gone;
}

// Web links from `from`, put back on the same spots of `to` (the same pages, redrawn as
// pictures, which keeps nothing clickable). A turned page is redrawn upright, so its links
// are turned with it.
export async function carryLinks(from, to) {
  const L = await lib();
  const N = (s) => L.PDFName.of(s);
  let carried = 0;
  from.getPages().forEach((page, i) => {
    const target = to.getPage(i);
    const { width: w, height: hgt } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const turn = ([x, y]) => (rot === 90 ? [y, w - x] : rot === 180 ? [w - x, hgt - y] : rot === 270 ? [hgt - y, x] : [x, y]);
    const refs = [];
    for (const { dict } of annotsOf(page, L)) {
      if (name(dict.lookup(N("Subtype"))) !== "Link") continue;
      const a = dict.lookup(N("A"));
      const uri = a instanceof L.PDFDict && name(a.lookup(N("S"))) === "URI" && a.lookup(N("URI"));
      const rect = dict.lookup(N("Rect"))?.asArray().map((v) => v.asNumber());
      if (!uri || !rect) continue;
      const [p, q] = [turn([rect[0], rect[1]]), turn([rect[2], rect[3]])];
      refs.push(to.context.register(to.context.obj({ Type: "Annot", Subtype: "Link", Border: [0, 0, 0],
        Rect: [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])],
        A: { S: "URI", URI: L.PDFString.of(text(uri)) } })));
    }
    if (refs.length) { target.node.set(N("Annots"), to.context.obj(refs)); carried += refs.length; }
  });
  return carried;
}
