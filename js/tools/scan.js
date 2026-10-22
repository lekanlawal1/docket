import { h, esc, dock, download, bytes, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { lib } from "../pdf.js";
import { openImage, toBlob } from "../images.js";
import { findPage, outputSize, warp, clean, blackAndWhite, colour } from "../scanmath.js";
import { handOff } from "../main.js";

export const intro = "Photos of paper pages, straightened and cleaned up into a PDF that looks scanned. Take them with your phone's camera or add ones you already have.";

const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);
const LOOKS = { clean, bw: blackAndWhite, colour, photo: (img) => img };
const SIZES = { fit: null, letter: [612, 792], a4: [595.28, 841.89] };
const INSET = [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]];

// The picture's pixels, at most `max` on its longer side.
export function pixels(bitmap, max) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k)), hgt = Math.max(1, Math.round(bitmap.height * k));
  const ctx = Object.assign(document.createElement("canvas"), { width: w, height: hgt }).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  return ctx.getImageData(0, 0, w, hgt);
}

// One page: the photo's corners straightened at `max` pixels, given the look, turned `rot` degrees.
export function flatten(page, look, max) {
  const src = pixels(page.bitmap, Math.max(max * 1.25, 1200));
  const px = page.quad.map(([x, y]) => [x * src.width, y * src.height]);
  const [w, hgt] = outputSize(px, max, [src.width, src.height]);
  const img = LOOKS[look](warp(src, px, w, hgt));
  const flat = Object.assign(document.createElement("canvas"), { width: w, height: hgt });
  flat.getContext("2d").putImageData(new ImageData(img.data, w, hgt), 0, 0);
  if (!page.rot) return flat;
  const turned = Object.assign(document.createElement("canvas"), page.rot % 180 ? { width: hgt, height: w } : { width: w, height: hgt });
  const ctx = turned.getContext("2d");
  ctx.translate(turned.width / 2, turned.height / 2);
  ctx.rotate((page.rot * Math.PI) / 180);
  ctx.drawImage(flat, -w / 2, -hgt / 2);
  return turned;
}

export function mount({ main, desk, files, privateNote }) {
  const pages = [];   // { file, bitmap, quad, found, rot, thumb }
  let current = 0;

  // on a phone this opens the camera straight away; on a computer it's an ordinary file picker
  const camera = () => {
    const el = h(`<label class="pill camera-btn">${svg("scan", { size: 18 })}<span>Take a photo</span><input type="file" accept="image/*" capture="environment" hidden></label>`);
    el.querySelector("input").addEventListener("change", (e) => { add([...e.target.files]); e.target.value = ""; });
    return el;
  };
  const start = h(`<div class="scan-start"></div>`);
  start.append(dock({ accept: "image/*,.heic,.heif", multiple: true, title: "Drop photos of your pages", hint: "Lay each page flat on a darker surface, in good light. HEIC, JPG and PNG all work.", onFiles: add }), camera());
  main.append(start);

  desk.innerHTML = `<h2>Scan</h2><p class="summary-line">Add photos of your pages to begin.</p>
    <label class="field">Look<select name="look">
      <option value="clean">Clean (grey, white paper)</option><option value="bw">Black and white (smallest, sharpest text)</option>
      <option value="colour">Colour (for stamps, signatures in ink, photos)</option><option value="photo">Original photo (no clean-up)</option></select></label>
    <label class="field">Page size<select name="size"><option value="fit">Same shape as the page</option><option value="letter">Letter</option><option value="a4">A4</option></select></label>
    <button type="button" class="pill go" disabled>Make PDF</button>
    <p class="status" role="status"></p>
    <div class="after" hidden><button type="button" class="pill ghost ocr">Make it searchable</button>
      <p class="note" style="margin-top: 8px">Reads the words on each page so you can search and copy them.</p></div>${privateNote()}`;
  const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".summary-line");
  const look = () => desk.querySelector("[name=look]").value;
  let made = null;

  // ---- the editor: the photo with its four corners, and the straightened page beside it
  const editor = h(`<div class="scan-editor">
    <div class="pager"><button type="button" class="icon-btn" aria-label="Previous page">${svg("left")}</button><span></span><button type="button" class="icon-btn" aria-label="Next page">${svg("right")}</button></div>
    <p class="scan-tip"></p>
    <div class="scan-pair">
      <div class="stage scan-stage"><svg class="scan-quad" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><polygon/></svg></div>
      <figure class="scan-result"><canvas></canvas><figcaption>
        <button type="button" class="pill ghost small rot">Turn</button>
        <button type="button" class="pill ghost small reset">Find edges again</button>
        <button type="button" class="pill ghost small whole">Use whole photo</button></figcaption></figure>
    </div></div>`);
  const stage = editor.querySelector(".scan-stage"), poly = editor.querySelector("polygon"), tip = editor.querySelector(".scan-tip");
  const [prev, next] = editor.querySelectorAll(".pager button");
  const resultCanvas = editor.querySelector(".scan-result canvas");
  const handles = [0, 1, 2, 3].map((i) => {
    const el = h(`<button type="button" class="corner" aria-label="${["Top left", "Top right", "Bottom right", "Bottom left"][i]} corner"></button>`);
    stage.append(el);
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.dataset.drag = "1"; });
    el.addEventListener("pointermove", (e) => {
      if (!el.dataset.drag) return;
      const r = stage.getBoundingClientRect();
      pages[current].quad[i] = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
      outline();
    });
    const drop = () => { if (el.dataset.drag) { delete el.dataset.drag; pages[current].found = true; outline(); refresh(); } };
    el.addEventListener("pointerup", drop);
    el.addEventListener("pointercancel", drop);
    // keyboard: arrows nudge the corner
    el.addEventListener("keydown", (e) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!step) return;
      e.preventDefault();
      const q = pages[current].quad[i];
      pages[current].quad[i] = [Math.min(1, Math.max(0, q[0] + step[0] * 0.005)), Math.min(1, Math.max(0, q[1] + step[1] * 0.005))];
      outline();
      clearTimeout(el.timer);
      el.timer = setTimeout(refresh, 250);
    });
    return el;
  });
  const lineup = h(`<ol class="lineup"></ol>`);
  const more = h(`<div class="scan-more"></div>`);
  more.append(dock({ accept: "image/*,.heic,.heif", multiple: true, small: true, title: "Add more pages", onFiles: add }), camera());

  prev.onclick = () => { current--; show(); };
  next.onclick = () => { current++; show(); };
  editor.querySelector(".rot").onclick = () => { pages[current].rot = (pages[current].rot + 90) % 360; refresh(); };
  editor.querySelector(".reset").onclick = () => { detect(pages[current]); show(); };
  editor.querySelector(".whole").onclick = () => { pages[current].quad = [[0, 0], [1, 0], [1, 1], [0, 1]]; pages[current].found = true; show(); };
  desk.querySelector("[name=look]").addEventListener("change", () => { pages.forEach((p) => (p.thumb = null)); refresh(); });

  function detect(page) {
    const quad = findPage(pixels(page.bitmap, 360));
    page.found = !!quad;
    page.quad = quad || INSET.map((c) => [...c]);
  }

  async function add(newFiles) {
    const imgs = newFiles.filter(isImage);
    if (imgs.length < newFiles.length) status(out, "Files that aren't pictures were skipped.", "bad");
    for (const file of imgs) {
      line.textContent = `Opening ${file.name}...`;
      let bitmap;
      try { bitmap = await openImage(file); } catch (err) { status(out, err.message, "bad"); continue; }
      const page = { file, bitmap, quad: null, found: false, rot: 0, thumb: null };
      detect(page);
      pages.push(page);
      current = pages.length - 1;
    }
    if (!pages.length) { line.textContent = "Add photos of your pages to begin."; return; }
    if (!editor.isConnected) { main.innerHTML = ""; main.append(editor, lineup, more); }
    show();
  }

  function show() {
    const page = pages[current];
    editor.querySelector(".pager span").textContent = `Page ${current + 1} of ${pages.length}`;
    prev.disabled = current === 0; next.disabled = current === pages.length - 1;
    stage.querySelector("canvas")?.remove();
    const k = Math.min(1, 1400 / Math.max(page.bitmap.width, page.bitmap.height));
    const photo = Object.assign(document.createElement("canvas"), { width: Math.round(page.bitmap.width * k), height: Math.round(page.bitmap.height * k) });
    photo.getContext("2d").drawImage(page.bitmap, 0, 0, photo.width, photo.height);
    stage.prepend(photo);
    outline();
    refresh();
  }

  function outline() {
    const q = pages[current].quad;
    poly.setAttribute("points", q.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" "));
    q.forEach(([x, y], i) => Object.assign(handles[i].style, { left: x * 100 + "%", top: y * 100 + "%" }));
    tip.textContent = pages[current].found
      ? "Drag the corners onto the corners of the page if they're off."
      : "Couldn't find the page's edges in this photo. Drag the four corners onto the corners of the page.";
    tip.classList.toggle("warn", !pages[current].found);
  }

  // the straightened preview of the page being edited, then the list below
  function refresh() {
    const page = pages[current];
    if (page) {
      const flat = flatten(page, look(), 900);
      Object.assign(resultCanvas, { width: flat.width, height: flat.height });
      resultCanvas.getContext("2d").drawImage(flat, 0, 0);
      page.thumb = null;
    }
    draw();
  }

  function draw() {
    lineup.innerHTML = "";
    pages.forEach((page, i) => {
      if (!page.thumb) {
        const t = flatten(page, look(), 160);
        page.thumb = t.toDataURL("image/jpeg", 0.8);
      }
      const row = h(`<li class="${i === current ? "on" : ""}"><span class="num">${i + 1}</span>
        <img src="${page.thumb}" alt="" style="width: 44px; height: 56px; object-fit: contain; background: #fff; border-radius: 4px; flex: none">
        <span class="info"><b>${esc(page.file.name)}</b><small>${page.found ? "edges set" : "edges not found, set them by hand"} · ${bytes(page.file.size)}</small></span>
        <span class="tools-row">
          <button type="button" class="icon-btn" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${svg("up")}</button>
          <button type="button" class="icon-btn" aria-label="Move down" ${i === pages.length - 1 ? "disabled" : ""}>${svg("down")}</button>
          <button type="button" class="icon-btn" aria-label="Remove page ${i + 1}">${svg("close")}</button>
        </span></li>`);
      const [up, down, remove] = row.querySelectorAll("button");
      const move = (j) => { [pages[i], pages[j]] = [pages[j], pages[i]]; if (current === i) current = j; else if (current === j) current = i; show(); };
      // tapping the page itself opens it in the editor above
      row.querySelector(".info").onclick = row.querySelector("img").onclick = () => { if (current !== i) { current = i; show(); } editor.scrollIntoView({ behavior: "smooth", block: "start" }); };
      up.onclick = () => move(i - 1);
      down.onclick = () => move(i + 1);
      remove.onclick = () => {
        pages.splice(i, 1);
        if (!pages.length) { main.innerHTML = ""; main.append(start); draw(); return; }
        current = Math.min(current, pages.length - 1);
        show();
      };
      lineup.append(row);
    });
    const unset = pages.filter((p) => !p.found).length;
    line.textContent = pages.length
      ? `${plural(pages.length, "page")}${unset ? `; ${unset} still ${unset === 1 ? "needs its" : "need their"} corners set` : ""}.`
      : "Add photos of your pages to begin.";
    go.disabled = !pages.length;
    desk.querySelector(".after").hidden = true;
  }

  go.addEventListener("click", () => busy(go, out, "Making PDF...", async () => {
    const { PDFDocument } = await lib();
    const doc = await PDFDocument.create();
    const size = SIZES[desk.querySelector("[name=size]").value], kind = look();
    for (const [i, page] of pages.entries()) {
      status(out, `Straightening page ${i + 1} of ${pages.length}...`);
      await new Promise((r) => setTimeout(r));   // let the message show
      const flat = flatten(page, kind, 2200);
      // black and white compresses best as PNG; anything with shades of grey as JPG
      const png = kind === "bw";
      const data = new Uint8Array(await (await toBlob(flat, png ? "image/png" : "image/jpeg", 0.82)).arrayBuffer());
      const img = png ? await doc.embedPng(data) : await doc.embedJpg(data);
      // "same shape": the longer side is 11 inches, like a sheet of Letter
      const fit = 792 / Math.max(img.width, img.height);
      const [pw, ph] = size ? (img.width > img.height ? [size[1], size[0]] : size) : [img.width * fit, img.height * fit];
      const p = doc.addPage([pw, ph]);
      const s = Math.min(pw / img.width, ph / img.height);
      p.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
    const data = await doc.save();
    const name = pages.length === 1 ? pages[0].file.name.replace(/\.[^.]+$/, "-scan.pdf") : "scan.pdf";
    download(data, name);
    made = new File([data], name, { type: "application/pdf" });
    status(out, `Done: ${plural(pages.length, "page")}, ${bytes(data.length)}.`, "good");
    desk.querySelector(".after").hidden = false;
  }));

  desk.querySelector(".ocr").addEventListener("click", () => { handOff([made]); location.hash = "#/searchable"; });

  const first = files.filter(isImage);
  if (first.length) add(first);
}
