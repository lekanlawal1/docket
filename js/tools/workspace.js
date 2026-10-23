import { h, esc, dock, download, bytes, plural, status, thumbnails } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForView, openForEdit, lib } from "../pdf.js";
import { findTool } from "../tools.js";
import { handOff } from "../main.js";
import { ws, current, active, begin, canUndo, canRedo, undo, redo, jump, clear } from "../workspace.js";

export const intro = "Open one PDF and make all your changes to it here: organise, sign, add text, compress, protect and more. Every step is kept, so you can undo, and you download once at the end.";

// What can be done to the document, each opening that tool with it loaded
const GROUPS = [
  ["Pages", ["organise", "crop", "blank-pages", "n-up", "extract"]],
  ["Add to it", ["annotate", "sign", "fill-form", "page-numbers", "watermark", "merge"]],
  ["Protect", ["redact", "metadata", "password"]],
  ["Fix and shrink", ["compress", "searchable", "flatten", "grayscale", "repair"]],
];

const isPdf = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
let savedAt = -1;   // the step last downloaded, to warn before losing unsaved work

addEventListener("beforeunload", (e) => {
  if (active() && ws.at > 0 && savedAt !== ws.at) { e.preventDefault(); e.returnValue = ""; }
});

export function mount({ main, desk, files, privateNote }) {
  const start = () => {
    main.innerHTML = "";
    main.append(dock({ accept: ".pdf,application/pdf", multiple: true, title: "Drop the PDF you want to work on", hint: "Several? They're joined into one first, in the order you choose them.", onFiles: open }));
    desk.innerHTML = `<h2>Workspace</h2>
      <p>Open a PDF, then pick changes one after another. Each one opens the right tool with your document already in it, and brings the result back here.</p>
      <p class="note">Undo any step, or go back to an earlier one. Nothing leaves this device, and the Workspace is cleared when you close the tab.</p>${privateNote()}`;
  };

  async function open(newFiles) {
    const pdfs = newFiles.filter(isPdf);
    if (!pdfs.length) { start(); main.append(h(`<p class="status bad">That isn't a PDF.</p>`)); return; }
    if (pdfs.length === 1) { begin(pdfs[0]); savedAt = -1; return show(); }
    // several: join them, as Merge would, so there's one document to work on
    const { PDFDocument } = await lib();
    const out = await PDFDocument.create();
    for (const f of pdfs) {
      const src = await openForEdit(await readBytes(f));
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    }
    begin(new File([await out.save()], "merged.pdf", { type: "application/pdf" }), `Joined ${plural(pdfs.length, "file")}`);
    savedAt = -1;
    show();
  }

  async function show() {
    const file = current();
    main.innerHTML = "";
    const bar = h(`<div class="ws-bar">
      <div class="ws-name"><b>${esc(ws.name)}</b><small>${bytes(file.size)} · step ${ws.at + 1} of ${ws.steps.length}</small></div>
      <div class="ws-actions">
        <button type="button" class="icon-btn" data-act="undo" aria-label="Undo" ${canUndo() ? "" : "disabled"}>${svg("undo")}</button>
        <button type="button" class="icon-btn" data-act="redo" aria-label="Redo" ${canRedo() ? "" : "disabled"}>${svg("redo")}</button>
      </div></div>`);
    const grid = h(`<div class="ws-pages" aria-label="Pages"></div>`);
    main.append(bar, grid);
    bar.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "undo") { undo(); show(); }
      if (act === "redo") { redo(); show(); }
    });

    desk.innerHTML = `<h2>Edit</h2>
      ${GROUPS.map(([name, ids]) => `<div class="ws-group"><div class="ws-group-name">${name}</div><div class="next-chips">${ids.map(findTool).filter(Boolean)
        .map((t) => `<button type="button" class="next-chip" data-tool="${t.id}">${svg(t.icon, { size: 18 })}<span>${esc(t.name)}</span></button>`).join("")}</div></div>`).join("")}
      <h2 style="margin-top: 22px">History</h2>
      <ol class="ws-history">${ws.steps.map((s, i) => `<li><button type="button" data-step="${i}" class="${i === ws.at ? "on" : i > ws.at ? "undone" : ""}" ${i === ws.at ? 'aria-current="step"' : ""}>
        <span class="n">${i + 1}</span><span class="what">${esc(s.label)}</span><small>${bytes(s.file.size)}</small></button></li>`).join("")}</ol>
      <label class="field" style="margin-top: 18px">Save as<input type="text" name="saveName" value="${esc(ws.name)}"></label>
      <button type="button" class="pill go">Download</button>
      <button type="button" class="pill ghost restart" style="margin-top: 8px">Start over with another PDF</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const out = desk.querySelector(".status");

    desk.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => {
      ws.pending = b.dataset.tool;
      handOff([current()]);
      location.hash = "#/" + b.dataset.tool;
    }));
    desk.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { jump(Number(b.dataset.step)); show(); }));
    desk.querySelector(".go").addEventListener("click", () => {
      const name = desk.querySelector("[name=saveName]").value.trim().replace(/(\.pdf)?$/i, ".pdf") || "document.pdf";
      download(current(), name);
      savedAt = ws.at;
      status(out, `Downloaded ${name}, ${bytes(current().size)}.`, "good");
    });
    desk.querySelector(".restart").addEventListener("click", () => {
      if (ws.at > 0 && savedAt !== ws.at && !confirm("Your changes haven't been downloaded. Start over anyway?")) return;
      clear();
      start();
    });

    // the pages as they are now
    try {
      const view = await openForView(await readBytes(file));
      if (current() !== file) return;   // moved on while drawing
      await thumbnails(grid, view, (i, canvas) => {
        const card = h(`<figure class="ws-page"><figcaption>${i + 1}</figcaption></figure>`);
        card.prepend(canvas);
        return card;
      }, 150);
    } catch (err) {
      grid.append(h(`<p class="status ${/password/i.test(err.message) ? "" : "bad"}">${/password/i.test(err.message)
        ? "This step is password-protected, so the pages can't be shown. Download it, or undo to keep editing."
        : "These pages couldn't be shown: " + esc(err.message)}</p>`));
    }
  }

  const first = files.filter(isPdf);
  if (first.length) open(first);
  else if (active()) show();
  else start();
}
