// Shrinking the pictures inside a PDF while leaving its text alone. Each large image is
// decoded, scaled down if it's bigger than the level allows, saved again as a JPEG, and put
// back in the same place in the file. Anything this can't decode safely is left as it was.

import { lib } from "./pdf.js";

const inflate = async (bytes) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());

// PNG-style row filters, which some PDFs apply before compressing an image (Predictor >= 10)
function unpredict(data, width, colors, height) {
  const row = width * colors, out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const type = data[y * (row + 1)], src = y * (row + 1) + 1, at = y * row;
    for (let x = 0; x < row; x++) {
      const a = x >= colors ? out[at + x - colors] : 0, b = y ? out[at - row + x] : 0, c = y && x >= colors ? out[at - row + x - colors] : 0;
      const v = data[src + x];
      let p = 0;
      if (type === 1) p = a;
      else if (type === 2) p = b;
      else if (type === 3) p = (a + b) >> 1;
      else if (type === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[at + x] = (v + p) & 255;
    }
  }
  return out;
}

// How many colour channels an image's colour space has: 1 or 3, or null for ones this
// doesn't handle (CMYK, indexed palettes, spot colours).
function channels(cs, { PDFName, PDFArray }, context) {
  cs = context.lookup(cs);
  if (cs === PDFName.of("DeviceRGB") || cs === PDFName.of("CalRGB")) return 3;
  if (cs === PDFName.of("DeviceGray") || cs === PDFName.of("CalGray")) return 1;
  if (cs instanceof PDFArray && context.lookup(cs.get(0)) === PDFName.of("ICCBased")) {
    const n = context.lookup(cs.get(1)).dict.get(PDFName.of("N"))?.asNumber?.();
    return n === 3 || n === 1 ? n : null;
  }
  if (cs instanceof PDFArray) return channels(cs.get(0), { PDFName, PDFArray }, context);   // [/CalRGB << >>]
  return null;
}

// The image as something a canvas can draw, or null if it's a kind this leaves alone.
async function decode(stream, kit, context) {
  const { PDFName, PDFArray, PDFNumber, PDFBool } = kit;
  const d = stream.dict;
  const get = (k) => context.lookup(d.get(PDFName.of(k)));
  if (get("ImageMask") === PDFBool.True || get("Decode")) return null;
  let filters = get("Filter");
  filters = filters instanceof PDFArray ? filters.asArray().map((f) => context.lookup(f)) : filters ? [filters] : [];
  const width = get("Width")?.asNumber(), height = get("Height")?.asNumber();
  if (!width || !height) return null;

  if (filters.length === 1 && filters[0] === PDFName.of("DCTDecode")) {
    const n = channels(get("ColorSpace"), kit, context);
    if (n !== 3 && n !== 1) return null;             // CMYK JPEGs come out inverted in some browsers
    try { return await createImageBitmap(new Blob([stream.contents], { type: "image/jpeg" })); } catch { return null; }
  }
  if (filters.length === 1 && filters[0] === PDFName.of("FlateDecode")) {
    const n = channels(get("ColorSpace"), kit, context);
    if (!n || get("BitsPerComponent")?.asNumber() !== 8) return null;
    let raw;
    try { raw = await inflate(stream.contents); } catch { return null; }
    const parms = get("DecodeParms");
    const predictor = parms?.get?.(PDFName.of("Predictor"))?.asNumber?.() ?? 1;
    if (predictor >= 10) raw = unpredict(raw, width, n, height);
    else if (predictor !== 1) return null;
    if (raw.length < width * height * n) return null;
    const rgba = new ImageData(width, height);
    for (let i = 0, j = 0; i < width * height; i++, j += n) {
      rgba.data[i * 4] = raw[j];
      rgba.data[i * 4 + 1] = raw[j + (n === 3 ? 1 : 0)];
      rgba.data[i * 4 + 2] = raw[j + (n === 3 ? 2 : 0)];
      rgba.data[i * 4 + 3] = 255;
    }
    return createImageBitmap(rgba);
  }
  return null;
}

// level: { maxSide, quality }. Returns the new file and what changed.
export async function shrinkImages(doc, { maxSide, quality }, onImage) {
  const kit = await lib();
  const { PDFName, PDFRawStream } = kit;
  const context = doc.context;
  const images = context.enumerateIndirectObjects().filter(([, o]) =>
    o instanceof PDFRawStream && context.lookup(o.dict.get(PDFName.of("Subtype"))) === PDFName.of("Image"));

  let shrunk = 0, before = 0, after = 0, i = 0;
  for (const [ref, stream] of images) {
    onImage?.(++i, images.length);
    if (stream.contents.length < 20_000) continue;    // small images aren't worth it
    const bitmap = await decode(stream, kit, context);
    if (!bitmap) continue;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), hgt = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: hgt });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, hgt);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, hgt);
    bitmap.close?.();
    const jpg = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality))).arrayBuffer());
    canvas.width = canvas.height = 0;
    if (jpg.length >= stream.contents.length * 0.9) continue;   // not enough to be worth the quality

    const dict = context.obj({
      Type: "XObject", Subtype: "Image", Width: w, Height: hgt,
      ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode", Length: jpg.length,
    });
    // a soft mask (transparency) is its own image and still lines up, so it carries over
    const smask = stream.dict.get(PDFName.of("SMask"));
    if (smask) dict.set(PDFName.of("SMask"), smask);
    context.assign(ref, PDFRawStream.of(dict, jpg));
    before += stream.contents.length;
    after += jpg.length;
    shrunk++;
  }
  return { images: images.length, shrunk, saved: before - after };
}
