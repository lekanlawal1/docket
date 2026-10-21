import { h, esc, dock, download, bytes, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { lib, readBytes } from "../pdf.js";

export const intro = "Line the files up in the order you want, then merge. Everything happens on this device.";

export function mount({ main, desk, files, privateNote }) {
  let list = [];   // [{ file, pages }]

  const lineup = h(`<ol class="lineup"></ol>`);
  const more = dock({ accept: ".pdf,application/pdf", multiple: true, small: true, title: "Add PDFs", onFiles: add });
  main.append(dock({ accept: ".pdf,application/pdf", multiple: true, title: "Drop the PDFs to merge", hint: "Two or more. You can reorder them next.", onFiles: add }));

  desk.innerHTML = `<h2>Ready to merge</h2><p class="summary">Add at least two PDFs.</p>
    <label class="field">File name<input type="text" value="merged.pdf"></label>
    <button type="button" class="pill go" disabled>Merge</button>
    <p class="status" role="status"></p>${privateNote()}`;
  const go = desk.querySelector("button"), out = desk.querySelector(".status"), nameInput = desk.querySelector("input");

  async function add(newFiles) {
    const { PDFDocument } = await lib();
    for (const file of newFiles) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { status(out, `${file.name} isn't a PDF, so it was skipped.`, "bad"); continue; }
      try {
        const doc = await PDFDocument.load(await readBytes(file), { updateMetadata: false });
        list.push({ file, pages: doc.getPageCount() });
      } catch (err) {
        status(out, `${file.name} couldn't be opened${/encrypt/i.test(err.message) ? " (it's password-protected)" : ""}, so it was skipped.`, "bad");
      }
    }
    draw();
  }

  function move(i, by) {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    draw();
  }

  function draw() {
    if (list.length && !lineup.isConnected) { main.innerHTML = ""; main.append(lineup, more); }
    lineup.innerHTML = "";
    list.forEach((item, i) => {
      const row = h(`<li><span class="num">${i + 1}</span>
        <span class="info"><b>${esc(item.file.name)}</b><small>${plural(item.pages, "page")} · ${bytes(item.file.size)}</small></span>
        <span class="tools-row">
          <button type="button" class="icon-btn" aria-label="Move ${esc(item.file.name)} up" ${i === 0 ? "disabled" : ""}>${svg("up")}</button>
          <button type="button" class="icon-btn" aria-label="Move ${esc(item.file.name)} down" ${i === list.length - 1 ? "disabled" : ""}>${svg("down")}</button>
          <button type="button" class="icon-btn" aria-label="Remove ${esc(item.file.name)}">${svg("close")}</button>
        </span></li>`);
      const [up, down, remove] = row.querySelectorAll("button");
      up.onclick = () => move(i, -1);
      down.onclick = () => move(i, 1);
      remove.onclick = () => { list.splice(i, 1); draw(); };
      lineup.append(row);
    });
    const pages = list.reduce((n, x) => n + x.pages, 0);
    desk.querySelector(".summary").textContent = list.length < 2 ? "Add at least two PDFs." : `${plural(list.length, "file")}, ${plural(pages, "page")} in total, in the order shown.`;
    go.disabled = list.length < 2;
    go.textContent = list.length < 2 ? "Merge" : `Merge ${list.length} files`;
  }

  go.addEventListener("click", () => busy(go, out, "Merging...", async () => {
    const { PDFDocument } = await lib();
    const merged = await PDFDocument.create();
    for (const { file } of list) {
      const src = await PDFDocument.load(await readBytes(file), { updateMetadata: false });
      for (const page of await merged.copyPages(src, src.getPageIndices())) merged.addPage(page);
    }
    const data = await merged.save();
    const name = nameInput.value.trim().replace(/(\.pdf)?$/i, ".pdf") || "merged.pdf";
    download(data, name);
    status(out, `Done: ${name}, ${plural(merged.getPageCount(), "page")}, ${bytes(data.length)}.`, "good");
  }));

  if (files.length) add(files);
}
