// The pictures on a PDF page, for PDF to Word: where each one is drawn, and its pixels as a
// PNG or JPEG. pdf.js gives the drawing instructions in order, so following the saves,
// restores and transforms says where each picture lands.

// Pixels from pdf.js as a canvas. Newer builds hand over an ImageBitmap; otherwise it's raw
// data in one of three layouts.
function toCanvas(img) {
  const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const ctx = c.getContext("2d");
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
  if (!img.data) return null;
  const out = ctx.createImageData(img.width, img.height), d = out.data, src = img.data;
  const n = img.width * img.height;
  if (img.kind === 3) d.set(src.subarray(0, n * 4));                                   // RGBA
  else if (img.kind === 2) for (let i = 0; i < n; i++) { d[i * 4] = src[i * 3]; d[i * 4 + 1] = src[i * 3 + 1]; d[i * 4 + 2] = src[i * 3 + 2]; d[i * 4 + 3] = 255; }
  else if (img.kind === 1) {                                                          // 1 bit per pixel, rows padded to bytes
    const row = (img.width + 7) >> 3;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const v = (src[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      const i = (y * img.width + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return c;
}

// PNG keeps see-through parts and crisp diagrams; big opaque pictures are photos, so JPEG.
async function encode(canvas) {
  const ctx = canvas.getContext("2d"), { width: w, height: h } = canvas;
  const sample = ctx.getImageData(0, 0, w, h).data;
  let alpha = false;
  for (let i = 3; i < sample.length; i += 4 * 97) if (sample[i] < 250) { alpha = true; break; }
  const jpeg = !alpha && w * h > 40_000;
  const blob = await new Promise((r) => canvas.toBlob(r, jpeg ? "image/jpeg" : "image/png", 0.88));
  return { data: new Uint8Array(await blob.arrayBuffer()), ext: jpeg ? "jpeg" : "png" };
}

const fetchImage = (page, id) => new Promise((resolve) => {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  try { store.get(id, resolve); } catch { resolve(null); }
  setTimeout(() => resolve(null), 4000);         // an image that never arrives shouldn't hang the page
});

// `toPage` maps PDF user space to the page as laid out for layout.js (top-down, in points).
export async function pagePictures(page, opList, { OPS, Util }, toPage) {
  const found = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], args = opList.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args[0]) ctm = Util.transform(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const m = Util.transform(toPage, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => Util.applyTransform(p, m));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      found.push({ ref: fn === OPS.paintImageXObject ? args[0] : null, inline: fn === OPS.paintInlineImageXObject ? args[0] : null,
        x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
    }
  }

  const out = [];
  for (const f of found) {
    if (f.width < 24 && f.height < 24) continue;     // bullets, rules and specks
    const img = f.inline || (await fetchImage(page, f.ref));
    if (!img) continue;
    const canvas = toCanvas(img);
    if (!canvas) continue;
    out.push({ x: f.x, y: f.y, width: f.width, height: f.height, key: `${img.width}x${img.height}`, ...(await encode(canvas)) });
    canvas.width = canvas.height = 0;
  }
  return out;
}
