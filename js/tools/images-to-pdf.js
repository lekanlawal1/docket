import { h, esc, dock, download, bytes, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { lib } from "../pdf.js";
import { openImage } from "../images.js";

export const intro = "Photos, scans and screenshots into one PDF, one image per page.";

const SIZES = { fit: null, letter: [612, 792], a4: [595.28, 841.89] };
const MARGINS = { none: 0, small: 18, wide: 42 };

// Any image the browser can show becomes a JPG or PNG that pdf-lib can embed.
async function asEmbeddable(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  if (file.type === "image/jpeg") return { kind: "jpg", data: raw };
  if (file.type === "image/png") return { kind: "png", data: raw };
  const bitmap = await openImage(file);
  const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  return { kind: "jpg", data: new Uint8Array(await blob.arrayBuffer()) };
}

export function mount({ main, desk, files, privateNote }) {
  let list = [];
  const lineup = h(`<ol class="lineup"></ol>`);
  const more = dock({ accept: "image/*,.heic,.heif", multiple: true, small: true, title: "Add images", onFiles: add });
  main.append(dock({ accept: "image/*,.heic,.heif", multiple: true, title: "Drop your images", hint: "JPG, PNG, WebP, iPhone photos (HEIC). You can reorder them next.", onFiles: add }));

  desk.innerHTML = `<h2>Page setup</h2><p class="summary">Add some images.</p>
    <label class="field">Page size<select name="size"><option value="fit">Same as each image</option><option value="letter">Letter</option><option value="a4">A4</option></select></label>
    <label class="field">Margin<select name="margin"><option value="none">None</option><option value="small" selected>Small</option><option value="wide">Wide</option></select></label>
    <button type="button" class="pill go" disabled>Make PDF</button>
    <p class="status" role="status"></p>${privateNote()}`;
  const go = desk.querySelector("button"), out = desk.querySelector(".status");

  function add(newFiles) {
    const imgs = newFiles.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (imgs.length < newFiles.length) status(out, "Files that aren't images were skipped.", "bad");
    list.push(...imgs.map((file) => ({ file, url: URL.createObjectURL(file) })));
    draw();
  }

  function draw() {
    if (list.length && !lineup.isConnected) { main.innerHTML = ""; main.append(lineup, more); }
    lineup.innerHTML = "";
    list.forEach((item, i) => {
      const row = h(`<li><span class="num">${i + 1}</span>
        <img src="${item.url}" alt="" style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px; flex: none">
        <span class="info"><b>${esc(item.file.name)}</b><small>${bytes(item.file.size)}</small></span>
        <span class="tools-row">
          <button type="button" class="icon-btn" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${svg("up")}</button>
          <button type="button" class="icon-btn" aria-label="Move down" ${i === list.length - 1 ? "disabled" : ""}>${svg("down")}</button>
          <button type="button" class="icon-btn" aria-label="Remove">${svg("close")}</button>
        </span></li>`);
      const [up, down, remove] = row.querySelectorAll("button");
      up.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); };
      down.onclick = () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); };
      remove.onclick = () => { URL.revokeObjectURL(item.url); list.splice(i, 1); draw(); };
      lineup.append(row);
    });
    desk.querySelector(".summary").textContent = list.length ? `${plural(list.length, "image")}, one per page.` : "Add some images.";
    go.disabled = !list.length;
  }

  go.addEventListener("click", () => busy(go, out, "Making PDF...", async () => {
    const { PDFDocument } = await lib();
    const doc = await PDFDocument.create();
    const size = SIZES[desk.querySelector("[name=size]").value];
    const margin = MARGINS[desk.querySelector("[name=margin]").value];
    for (const { file } of list) {
      const { kind, data } = await asEmbeddable(file);
      const img = kind === "png" ? await doc.embedPng(data) : await doc.embedJpg(data);
      // a fixed paper size turns to landscape for wide images
      let [pw, ph] = size ? (img.width > img.height ? [size[1], size[0]] : size) : [img.width * 0.75 + margin * 2, img.height * 0.75 + margin * 2];
      const page = doc.addPage([pw, ph]);
      const fit = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * fit, hh = img.height * fit;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
    }
    const data = await doc.save();
    download(data, list.length === 1 ? list[0].file.name.replace(/\.[^.]+$/, ".pdf") : "images.pdf");
    status(out, `Done: ${plural(list.length, "page")}, ${bytes(data.length)}.`, "good");
  }));

  if (files.length) add(files);
}
