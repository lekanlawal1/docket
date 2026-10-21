// Shared bits for the image tools: open one picture, draw it at a new size, save it.

import { dock, h, esc, bytes } from "./ui.js";

export const FORMATS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const isHeic = (file) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

// iPhone photos (HEIC) only open natively in Safari. Elsewhere they go through libheif, about
// 3 MB, which is only fetched when one turns up.
export async function openImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap) return bitmap;
  if (isHeic(file)) {
    try {
      const { heicTo } = await import("../vendor/heic-to/heic-to.js");
      return await heicTo({ blob: file, type: "bitmap" });
    } catch (err) {
      console.error(err);
      throw new Error(`${file.name} couldn't be read. It may be damaged, or a kind of HEIC this can't open; try exporting it as JPG.`);
    }
  }
  throw new Error(`${file.name} can't be opened by this browser.`);
}

// Draws `bitmap` onto a w×h canvas. With `crop`, it fills the frame and trims the overflow
// evenly; without, it's simply stretched to w×h (callers keep the shape themselves).
export function drawn(bitmap, w, hgt, { crop = false, background = null } = {}) {
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: hgt });
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, hgt); }
  if (crop) {
    const s = Math.max(w / bitmap.width, hgt / bitmap.height);
    const sw = w / s, sh = hgt / s;
    ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, hgt);
  } else {
    ctx.drawImage(bitmap, 0, 0, w, hgt);
  }
  return canvas;
}

export const toBlob = (canvas, type, quality) => new Promise((r) => canvas.toBlob(r, type, quality));

// JPG has no see-through parts, so it gets a white background instead of black.
export const needsBackground = (type) => type === "image/jpeg";

// The usual start for a one-image tool, like onePdf but for pictures.
export function oneImage(main, { files = [], onLoad }) {
  const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);
  const start = () => {
    main.innerHTML = "";
    main.append(dock({ accept: "image/*,.heic,.heif", title: "Drop a picture here", hint: "JPG, PNG, WebP, iPhone photos (HEIC) and most others.", onFiles: ([f]) => open(f) }));
  };
  const open = async (file) => {
    if (!isImage(file)) { start(); main.append(h(`<p class="status bad">${esc(file.name)} isn't a picture.</p>`)); return; }
    let bitmap;
    try { bitmap = await openImage(file); }
    catch (err) { start(); main.append(h(`<p class="status bad">${esc(err.message)}</p>`)); return; }
    main.innerHTML = "";
    const bar = h(`<div class="result" style="margin-bottom: 16px"><span><b>${esc(file.name)}</b> <small style="color: var(--muted)">${bitmap.width} × ${bitmap.height}, ${bytes(file.size)}</small></span>
      <button type="button" class="pill ghost">Use a different picture</button></div>`);
    bar.querySelector("button").addEventListener("click", start);
    main.append(bar);
    onLoad(file, bitmap);
  };
  const first = files.find(isImage);
  first ? open(first) : start();
}

// A preview that fits the column, for the result of a resize or compress.
export function preview(blob) {
  const url = URL.createObjectURL(blob);
  const el = h(`<figure style="margin: 0"><img alt="Preview of the result" style="display: block; max-width: 100%; max-height: 60vh; border-radius: 8px; box-shadow: 0 1px 6px rgba(0,0,0,.2)"></figure>`);
  const img = el.querySelector("img");
  img.onload = () => URL.revokeObjectURL(url);
  img.src = url;
  return el;
}
