import { h, esc, dock, download, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { openImage } from "../images.js";
import { findPage } from "../scanmath.js";
import { reader, readAnyWayUp } from "../ocr.js";
import { pixels, flatten } from "./scan.js";

export const intro = "Copy the words out of a photo or screenshot: a textbook page, a handout, a receipt, a sign. Edit the text, then copy it or save it.";

const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);

// What gets read: a sheet of paper found in the photo is straightened and cleaned first (text
// at an angle reads badly); anything else (a screenshot, a sign) is read as it is, at a size
// the reader handles well.
function prepare(bitmap, straighten) {
  const quad = straighten ? findPage(pixels(bitmap, 360)) : null;
  if (quad) return { canvas: flatten({ bitmap, quad, rot: 0 }, "clean", 2400), straightened: true };
  const k = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * k), height: Math.round(bitmap.height * k) });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";                       // see-through screenshots read as black otherwise
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, straightened: false };
}

export function mount({ main, desk, files, privateNote }) {
  const list = [];   // { file }
  const camera = () => {
    const el = h(`<label class="pill camera-btn">${svg("scan", { size: 18 })}<span>Take a photo</span><input type="file" accept="image/*" capture="environment" hidden></label>`);
    el.querySelector("input").addEventListener("change", (e) => { add([...e.target.files]); e.target.value = ""; });
    return el;
  };
  const start = h(`<div class="scan-start"></div>`);
  start.append(dock({ accept: "image/*,.heic,.heif", multiple: true, title: "Drop photos or screenshots", hint: "Printed text reads best. Several pictures are read in order, one after another.", onFiles: add }), camera());
  main.append(start);

  desk.innerHTML = `<h2>Read the words</h2><p class="summary-line">Add a picture to begin.</p>
    <label class="field">Language<select name="lang">
      <option value="eng">English</option><option value="fra">French</option><option value="eng+fra">English and French</option></select></label>
    <label class="check"><input type="checkbox" name="straighten" checked> Straighten pages photographed at an angle</label>
    <button type="button" class="pill go" disabled>Read text</button>
    <p class="status" role="status"></p>
    <p class="honest" style="margin-top: 14px">Reads printed text. Handwriting and blurry photos come out poorly, so check anything important. The first time, this downloads the reader (about 7 MB); after that it's cached.</p>${privateNote()}`;
  const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".summary-line");
  const lang = desk.querySelector("[name=lang]");
  if (/^fr\b/i.test(navigator.language || "")) lang.value = "fra";

  const lineup = h(`<ol class="lineup"></ol>`);
  const more = h(`<div class="scan-more"></div>`);
  more.append(dock({ accept: "image/*,.heic,.heif", multiple: true, small: true, title: "Add more", onFiles: add }), camera());
  const result = h(`<div class="ocr-result" hidden>
    <label class="field">Text<span class="note">You can fix mistakes here before copying.</span>
      <textarea class="out-text" spellcheck="true" aria-label="Text read from the pictures"></textarea></label>
    <div class="row-btns"><button type="button" class="pill copy">Copy text</button><button type="button" class="pill ghost save">Save as .txt</button></div>
  </div>`);
  const box = result.querySelector("textarea");
  result.querySelector(".copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(box.value); } catch { box.select(); document.execCommand("copy"); }
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy text"), 1500);
  };
  result.querySelector(".save").onclick = () => download(new Blob([box.value], { type: "text/plain;charset=utf-8" }), list.length === 1 ? list[0].file.name.replace(/\.[^.]+$/, ".txt") : "text-from-photos.txt");

  function add(newFiles) {
    const imgs = newFiles.filter(isImage);
    if (imgs.length < newFiles.length) status(out, "Files that aren't pictures were skipped.", "bad");
    list.push(...imgs.map((file) => ({ file, url: URL.createObjectURL(file) })));
    draw();
  }

  function draw() {
    if (list.length && !lineup.isConnected) { main.innerHTML = ""; main.append(lineup, more, result); }
    if (!list.length && !start.isConnected) { main.innerHTML = ""; main.append(start); result.hidden = true; }
    lineup.innerHTML = "";
    list.forEach((item, i) => {
      const row = h(`<li><span class="num">${i + 1}</span>
        <img src="${item.url}" alt="" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; flex: none">
        <span class="info"><b>${esc(item.file.name)}</b><small>${item.note ? esc(item.note) : "not read yet"}</small></span>
        <span class="tools-row">
          <button type="button" class="icon-btn" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${svg("up")}</button>
          <button type="button" class="icon-btn" aria-label="Remove ${esc(item.file.name)}">${svg("close")}</button>
        </span></li>`);
      const [up, remove] = row.querySelectorAll("button");
      up.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); };
      remove.onclick = () => { URL.revokeObjectURL(item.url); list.splice(i, 1); draw(); };
      lineup.append(row);
    });
    line.textContent = list.length ? `${plural(list.length, "picture")}, read in this order.` : "Add a picture to begin.";
    go.disabled = !list.length;
  }

  go.addEventListener("click", () => busy(go, out, "Reading...", async () => {
    let at = 0;
    status(out, "Getting the reader ready...");
    const worker = await reader((m) => {
      if (/loading|initializ/i.test(m.status) && !at) status(out, "Getting the reader ready (a one-time download)...");
      if (m.status === "recognizing text" && at) status(out, `Reading picture ${at} of ${list.length}: ${Math.round(m.progress * 100)}%`);
    }, lang.value);

    const parts = [], weak = [];
    let words = 0;
    for (const item of list) {
      at++;
      let bitmap;
      try { bitmap = await openImage(item.file); } catch (err) { item.note = err.message; continue; }
      const { canvas, straightened } = prepare(bitmap, desk.querySelector("[name=straighten]").checked);
      bitmap.close?.();
      const { data, found } = await readAnyWayUp(worker, canvas);
      canvas.width = canvas.height = 0;
      const text = data.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      words += found.length;
      item.note = text ? `${plural(found.length, "word")}, ${Math.round(data.confidence)}% confident${straightened ? ", page straightened" : ""}` : "no text found";
      if (text && data.confidence < 60) weak.push(at);
      if (text) parts.push(list.length > 1 ? `[${item.file.name}]\n${text}` : text);
    }
    draw();
    if (!words) { status(out, "No text could be read. The picture may be handwriting, too blurry, or too small.", "bad"); return; }
    box.value = parts.join("\n\n");
    result.hidden = false;
    status(out, `Done: ${plural(words, "word")} read.` + (weak.length ? ` Picture${weak.length > 1 ? "s" : ""} ${weak.join(", ")} came out unsure, so check ${weak.length > 1 ? "them" : "it"} closely.` : ""), "good");
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));

  const first = files.filter(isImage);
  if (first.length) add(first);
}
