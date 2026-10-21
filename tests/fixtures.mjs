// Builds the PDFs and picture the browser tests use, so no binary files live in the repo.
import { PDFDocument, StandardFonts, rgb, degrees } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
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
}

if (import.meta.url === `file://${process.argv[1]}`) await makeFixtures(process.argv[2] || "tests/.fixtures");
