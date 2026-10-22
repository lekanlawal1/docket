// Builds the PDFs and picture the browser tests use, so no binary files live in the repo.
import { PDFDocument, PDFName, PDFString, PDFOperator, StandardFonts, rgb, degrees } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export async function makeFixtures(dir) {
  mkdirSync(dir, { recursive: true });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle("Lease agreement");
  doc.setAuthor("Jordan Secret-Author");
  const lines = [
    "This lease is between the landlord and Jordan Example for the unit at 14 Harbour Road.",
    "The tenant agrees to pay rent of $1,450 on the first day of every month starting March 1, 2026.",
    "Late rent will be charged a fee of $50 after the fifth day of the month.",
    "Questions can be sent to landlord@example.com or by calling (705) 555-0142.",
    "Account number 4417-2290 is used for automatic payments each month.",
  ];
  for (let p = 0; p < 4; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${p + 1}`, { x: 50, y: 740, size: 18, font });
    lines.forEach((t, i) => page.drawText(t, { x: 50, y: 700 - i * 22, size: 11, font }));
    page.drawRectangle({ x: 50, y: 300, width: 200, height: 120, color: rgb(0.2, 0.5, 0.8) });
  }
  doc.getPage(3).setRotation(degrees(90));
  writeFileSync(join(dir, "lease.pdf"), await doc.save());

  // a second version of the lease: on page 2 the rent goes up, the late fee sentence is gone,
  // and an insurance sentence is new; page 3 is the same words wrapped onto different lines
  const v2 = await PDFDocument.create();
  const f2 = await v2.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 4; p++) {
    const page = v2.addPage([612, 792]);
    page.drawText(`Page ${p + 1}`, { x: 50, y: 740, size: 18, font: f2 });
    let text = lines;
    if (p === 1) text = [lines[0], lines[1].replace("$1,450", "$1,550"), lines[3], lines[4], "The tenant must keep contents insurance for the whole term."];
    if (p === 2) text = lines.join(" ").match(/.{1,70}(\s|$)/g).map((s) => s.trim());
    text.forEach((t, i) => page.drawText(t, { x: 50, y: 700 - i * 22, size: 11, font: f2 }));
  }
  writeFileSync(join(dir, "lease-v2.pdf"), await v2.save());

  // a damaged copy of the lease: the pointer to its index is wrong and the index is mangled,
  // like a file saved badly or cut short
  const good = await doc.save({ useObjectStreams: false });
  let text = Buffer.from(good).toString("latin1");
  text = text.replace(/startxref\s+\d+/, "startxref\n999999").replace(/xref\n0 \d+/, "xref\n0 3");
  writeFileSync(join(dir, "damaged.pdf"), Buffer.from(text, "latin1"));
  // and one cut short, like an interrupted download
  writeFileSync(join(dir, "cut-short.pdf"), good.slice(0, Math.floor(good.length * 0.93)));

  // blank pages to find: an empty page, one with only a page number, and a "scanned" blank
  // (pale grey with a few specks), between pages that have content
  const blanks = await PDFDocument.create();
  const bf = await blanks.embedFont(StandardFonts.Helvetica);
  const content = (t) => { const pg = blanks.addPage([612, 792]); pg.drawText(t, { x: 60, y: 700, size: 14, font: bf }); pg.drawText("Some more words on the page to make it real.", { x: 60, y: 670, size: 11, font: bf }); };
  content("Report, page one");
  blanks.addPage([612, 792]);
  blanks.addPage([612, 792]).drawText("3", { x: 300, y: 40, size: 10, font: bf });
  content("Report, page four");
  const grey = blanks.addPage([612, 792]);
  grey.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.93, 0.93, 0.92) });
  for (const [x, y] of [[100, 200], [400, 600], [250, 450]]) grey.drawCircle({ x, y, size: 1.2, color: rgb(0.3, 0.3, 0.3) });
  content("Report, page six");
  writeFileSync(join(dir, "blanks.pdf"), await blanks.save());

  // a page in French, for reading scans in another language
  const fr = await PDFDocument.create();
  const frFont = await fr.embedFont(StandardFonts.Helvetica);
  const fp1 = fr.addPage([612, 792]);
  ["Bail résidentiel", "Le locataire s'engage à payer un loyer de 1 450 $ le premier jour du mois.",
    "Le propriétaire doit effectuer les réparations nécessaires dans un délai raisonnable.",
    "Les animaux de compagnie sont acceptés. Le dépôt de garantie est interdit en Ontario."]
    .forEach((t, i) => fp1.drawText(t, { x: 50, y: 720 - i * 28, size: i ? 13 : 20, font: frFont }));
  writeFileSync(join(dir, "bail.pdf"), await fr.save());

  const small = await PDFDocument.create();
  small.addPage([612, 792]).drawText("A second file", { x: 50, y: 700, size: 14, font: await small.embedFont(StandardFonts.Helvetica) });
  writeFileSync(join(dir, "second.pdf"), await small.save());

  // a page of text with a large photo-like picture on it, for compression
  const photo = await PDFDocument.create();
  const pp = photo.addPage([612, 792]);
  pp.drawText("Harbour inspection report", { x: 50, y: 740, size: 18, font: await photo.embedFont(StandardFonts.Helvetica) });
  const W = 1800, H = 1200, px = new Uint8Array(W * H * 3);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 40) - 20;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    px[i] = Math.max(0, Math.min(255, 60 + (x / W) * 150 + noise()));
    px[i + 1] = Math.max(0, Math.min(255, 110 + (y / H) * 100 + noise()));
    px[i + 2] = Math.max(0, Math.min(255, 180 - (x / W) * 60 + noise()));
  }
  const img = photo.context.register(photo.context.flateStream(px, { Type: "XObject", Subtype: "Image", Width: W, Height: H, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
  const name = pp.node.newXObject("Photo", img);
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = await import("../vendor/pdf-lib/pdf-lib.esm.min.js");
  pp.pushOperators(pushGraphicsState(), concatTransformationMatrix(512, 0, 0, 341, 50, 330), drawObject(name), popGraphicsState());
  writeFileSync(join(dir, "photo.pdf"), await photo.save());

  const form = await PDFDocument.create();
  const fp = form.addPage([612, 792]);
  const f = form.getForm();
  f.createTextField("full_name").addToPage(fp, { x: 50, y: 700, width: 200, height: 24 });
  f.createCheckBox("agree").addToPage(fp, { x: 50, y: 650, width: 18, height: 18 });
  const dd = f.createDropdown("province");
  dd.addOptions(["Ontario", "Quebec"]);
  dd.addToPage(fp, { x: 50, y: 600, width: 150, height: 24 });
  writeFileSync(join(dir, "form.pdf"), await form.save());

  // a reviewed document: a filled field, and the marks PDF apps leave behind, each with its
  // own stored look (one without the usual XObject labels, one scaled by its own matrix)
  const marked = await PDFDocument.create();
  const helv = await marked.embedFont(StandardFonts.Helvetica);
  const ctx = marked.context;
  const look = (content, BBox, extra = {}) => ctx.register(ctx.stream(content, { BBox, ...extra }));
  const annot = (page, dict) => {
    const ref = ctx.register(ctx.obj({ Type: "Annot", ...dict }));
    const list = page.node.Annots();
    if (list) list.push(ref); else page.node.set(PDFName.of("Annots"), ctx.obj([ref]));
    return ref;
  };
  const m1 = marked.addPage([612, 792]);
  m1.drawText("Quarterly figures, for review", { x: 60, y: 740, size: 16, font: helv });
  const reviewer = marked.getForm().createTextField("reviewer");
  reviewer.setText("Ada Moss");
  reviewer.addToPage(m1, { x: 60, y: 640, width: 200, height: 24, font: helv });
  annot(m1, { Subtype: "Square", Rect: [60, 500, 160, 560], AP: { N: look("1 0 0 rg 0 0 100 60 re f", [0, 0, 100, 60]) } });
  annot(m1, { Subtype: "Stamp", Rect: [300, 400, 500, 480], AP: { N: look("0 0.6 0 rg 0 0 100 40 re f", [0, 0, 100, 40], { Type: "XObject", Subtype: "Form", Matrix: [0.5, 0, 0, 0.5, 0, 0] }) } });
  annot(m1, { Subtype: "FreeText", Rect: [60, 300, 260, 320], DA: PDFString.of("/Helv 12 Tf 0 g"),
    AP: { N: look("BT /Helv 12 Tf 0 g 2 5 Td (APPROVED BY REVIEW) Tj ET", [0, 0, 200, 20], { Resources: { Font: { Helv: helv.ref } } }) } });
  annot(m1, { Subtype: "Square", F: 2, Rect: [400, 600, 450, 650], AP: { N: look("0 0 1 rg 0 0 50 50 re f", [0, 0, 50, 50]) } });
  annot(m1, { Subtype: "Popup", Rect: [420, 300, 560, 360] });
  annot(m1, { Subtype: "Link", Rect: [60, 200, 200, 220], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://example.com/terms") } });
  const m2 = marked.addPage([612, 792]);
  m2.setRotation(degrees(90));
  annot(m2, { Subtype: "Link", Rect: [100, 300, 260, 320], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://example.com/annex") } });
  annot(m2, { Subtype: "Square", Rect: [100, 100, 200, 200], AP: { N: look("0.5 0 0.5 rg 0 0 100 100 re f", [0, 0, 100, 100]) } });
  writeFileSync(join(dir, "marked.pdf"), await marked.save());

  // a highlight saved without its look, as some apps do: only a drawing of the page keeps it
  const bare = await PDFDocument.create();
  const b1 = bare.addPage([612, 792]);
  b1.drawText("Highlighted line", { x: 60, y: 704, size: 14, font: await bare.embedFont(StandardFonts.Helvetica) });
  const href = bare.context.register(bare.context.obj({ Type: "Annot", Subtype: "Highlight", Rect: [56, 698, 220, 722], C: [1, 0.9, 0], QuadPoints: [56, 722, 220, 722, 56, 698, 220, 698] }));
  b1.node.set(PDFName.of("Annots"), bare.context.obj([href]));
  writeFileSync(join(dir, "bare-highlight.pdf"), await bare.save());

  // an offer letter carrying everything a file can carry: details, a reviewer's comment, an
  // attached spreadsheet, scripts, a link, a hidden layer, and an earlier version of itself
  const messy = await PDFDocument.create({ updateMetadata: false });
  messy.setAuthor("Priya Hidden-Author");
  messy.setTitle("Old draft title");
  const mf = await messy.embedFont(StandardFonts.Helvetica);
  const mc = messy.context;
  const mp = messy.addPage([612, 792]);
  mp.drawText("Offer letter", { x: 60, y: 720, size: 20, font: mf });
  const ocg = mc.register(mc.obj({ Type: "OCG", Name: PDFString.of("Internal notes") }));
  messy.catalog.set(PDFName.of("OCProperties"), mc.obj({ OCGs: [ocg], D: { ON: [], OFF: [ocg], Order: [ocg] } }));
  mp.node.Resources().set(PDFName.of("Properties"), mc.obj({ L1: ocg }));
  mp.pushOperators(PDFOperator.of("BDC", [PDFName.of("OC"), PDFName.of("L1")]));
  mp.drawText("SALARY BAND 95K INTERNAL", { x: 60, y: 600, size: 14, font: mf });
  mp.pushOperators(PDFOperator.of("EMC"));
  const popup = mc.register(mc.obj({ Type: "Annot", Subtype: "Popup", Rect: [300, 600, 500, 700] }));
  const note = mc.register(mc.obj({ Type: "Annot", Subtype: "Text", Rect: [520, 700, 540, 720], Contents: PDFString.of("Reviewer note: offer them less"), Popup: popup }));
  const link = mc.register(mc.obj({ Type: "Annot", Subtype: "Link", Rect: [60, 500, 260, 520], Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://example.com/offer") } }));
  const clicky = mc.register(mc.obj({ Type: "Annot", Subtype: "Link", Rect: [60, 460, 260, 480], Border: [0, 0, 0], A: { S: "JavaScript", JS: PDFString.of("app.alert('clicked')") } }));
  mp.node.set(PDFName.of("Annots"), mc.obj([note, popup, link, clicky]));
  await messy.attach(new TextEncoder().encode("name,salary\nSam,95000\n"), "salary-sheet.csv", { mimeType: "text/csv" });
  messy.addJavaScript("greet", "app.alert('tracking')");
  messy.catalog.set(PDFName.of("OpenAction"), mc.obj({ S: "JavaScript", JS: PDFString.of("app.alert('opened')") }));
  const first = Buffer.from(await messy.save({ useObjectStreams: false }));
  // saved again by adding to the end: a new title, with the old one still inside
  const raw = first.toString("latin1");
  const prev = Number(raw.match(/startxref\s+(\d+)/g).pop().match(/\d+/)[0]);
  const size = Number(raw.match(/\/Size (\d+)/g).pop().match(/\d+/)[0]);
  const root = raw.match(/\/Root (\d+ \d+ R)/g).pop().slice(6);
  const objAt = first.length + 1;
  const obj = `\n${size} 0 obj\n<< /Title (Final offer) /Author (Priya Hidden-Author) >>\nendobj\n`;
  const xrefAt = first.length + obj.length;
  const update = obj + `xref\n0 1\n0000000000 65535 f \n${size} 1\n${String(objAt).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${size + 1} /Root ${root} /Info ${size} 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  writeFileSync(join(dir, "messy.pdf"), Buffer.concat([first, Buffer.from(update, "latin1")]));
}

if (import.meta.url === `file://${process.argv[1]}`) await makeFixtures(process.argv[2] || "tests/.fixtures");
