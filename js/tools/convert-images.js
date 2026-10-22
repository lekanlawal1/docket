import { h, esc, dock, download, bytes, plural, busy, status } from "../ui.js";
import { openImage, drawn, toBlob, needsBackground, FORMATS } from "../images.js";
import { zip } from "../zip.js";
import { svg } from "../icons.js";

export const intro = "iPhone photos (HEIC), WebP, PNG and more, turned into JPG, PNG or WebP. One picture or a whole batch.";

const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);

export function mount({ main, desk, files, privateNote }) {
  const list = [];   // { file, bitmap, error }
  const lineup = h(`<ol class="lineup"></ol>`);
  const more = dock({ accept: "image/*,.heic,.heif", multiple: true, small: true, title: "Add more pictures", onFiles: add });
  main.append(dock({ accept: "image/*,.heic,.heif", multiple: true, title: "Drop your pictures", hint: "HEIC, WebP, PNG, JPG, GIF and most others.", onFiles: add }));

  desk.innerHTML = `<h2>Convert</h2><p class="summary-line">Add pictures to begin.</p>
    <label class="field">Save as<select name="type">
      <option value="image/jpeg">JPG (photos, smallest)</option><option value="image/png">PNG (sharp, keeps see-through parts)</option><option value="image/webp">WebP (small, for the web)</option></select></label>
    <label class="field" data-quality>Quality <span class="note q-note"></span><input type="range" name="quality" min="40" max="100" value="90"></label>
    <button type="button" class="pill go" disabled>Convert</button>
    <p class="status" role="status"></p>${privateNote()}`;
  const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".summary-line");
  const q = (n) => desk.querySelector(`[name=${n}]`);
  const refresh = () => {
    desk.querySelector("[data-quality]").hidden = q("type").value === "image/png";
    desk.querySelector(".q-note").textContent = `${q("quality").value}%`;
  };
  desk.addEventListener("input", refresh);
  refresh();

  async function add(newFiles) {
    for (const file of newFiles) {
      if (!isImage(file)) { status(out, `${file.name} isn't a picture, so it was skipped.`, "bad"); continue; }
      const item = { file, bitmap: null, error: null };
      list.push(item);
      draw();
      try { item.bitmap = await openImage(file); } catch (err) { item.error = err.message; }
      draw();
    }
  }

  function draw() {
    if (list.length && !lineup.isConnected) { main.innerHTML = ""; main.append(lineup, more); }
    lineup.innerHTML = "";
    list.forEach((item, i) => {
      const row = h(`<li><span class="num">${i + 1}</span>
        <span class="info"><b>${esc(item.file.name)}</b><small>${item.error ? `<span style="color: var(--bad)">${esc(item.error)}</span>`
          : item.bitmap ? `${item.bitmap.width} × ${item.bitmap.height} · ${bytes(item.file.size)}` : "opening..."}</small></span>
        <span class="tools-row"><button type="button" class="icon-btn" aria-label="Remove ${esc(item.file.name)}">${svg("close")}</button></span></li>`);
      row.querySelector("button").onclick = () => { list.splice(i, 1); draw(); };
      lineup.append(row);
    });
    const ready = list.filter((x) => x.bitmap).length;
    line.textContent = list.length ? `${plural(ready, "picture")} ready${list.length > ready ? `, ${list.length - ready} not` : ""}.` : "Add pictures to begin.";
    go.disabled = !ready;
  }

  go.addEventListener("click", () => busy(go, out, "Converting...", async () => {
    const type = q("type").value, ext = FORMATS[type], quality = Number(q("quality").value) / 100;
    const done = [], names = new Set();
    for (const [k, item] of list.filter((x) => x.bitmap).entries()) {
      status(out, `Converting ${k + 1}...`);
      const { width: w, height: hgt } = item.bitmap;
      const blob = await toBlob(drawn(item.bitmap, w, hgt, { background: needsBackground(type) ? "#fff" : null }), type, quality);
      // a browser that can't write this format quietly hands back PNG instead
      if (blob.type !== type) throw new Error(`this browser can't save ${ext.toUpperCase()} files. Try JPG or PNG.`);
      let name = item.file.name.replace(/\.[^.]+$/, "") + "." + ext;
      for (let n = 2; names.has(name); n++) name = item.file.name.replace(/\.[^.]+$/, "") + `-${n}.${ext}`;
      names.add(name);
      done.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (done.length === 1) download(new Blob([done[0].data], { type }), done[0].name);
    else download(zip(done), `pictures-${ext}.zip`, "application/zip");
    const before = list.filter((x) => x.bitmap).reduce((n, x) => n + x.file.size, 0), after = done.reduce((n, d) => n + d.data.length, 0);
    status(out, `Done: ${plural(done.length, "picture")} as ${ext.toUpperCase()}, ${bytes(before)} → ${bytes(after)}.`, "good");
  }));

  const first = files.filter(isImage);
  if (first.length) add(first);
}
