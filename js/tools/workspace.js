import { h, esc, dock, download, bytes, plural, status, thumbnails } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForView, openForEdit, lib } from "../pdf.js";
import { findTool } from "../tools.js";
import { handOff } from "../main.js";
import { ws, current, active, begin, canUndo, canRedo, undo, redo, jump, clear, resume, rename, forgetThis, keepThis, adopt } from "../workspace.js";
import { toProjectFile, fromProjectFile, EXT } from "../projectfile.js";
import * as store from "../projects.js";

export const intro = "Open one PDF and make all your changes to it here: organise, sign, add text, compress, protect and more. Every step is kept, so you can undo, and you download once at the end.";

// What can be done to the document, each opening that tool with it loaded
const GROUPS = [
  ["Pages", ["organise", "crop", "blank-pages", "n-up", "extract"]],
  ["Add to it", ["annotate", "sign", "fill-form", "page-numbers", "watermark", "merge"]],
  ["Protect", ["redact", "metadata", "password"]],
  ["Fix and shrink", ["compress", "searchable", "flatten", "grayscale", "repair"]],
];

const isPdf = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
const isProject = (f) => f.name.toLowerCase().endsWith(EXT);
let savedAt = -1;   // the step last downloaded, to warn before losing unsaved work

// only work that isn't being kept on the device needs a warning before the tab closes
addEventListener("beforeunload", (e) => {
  if (active() && !ws.saved && ws.at > 0 && savedAt !== ws.at) { e.preventDefault(); e.returnValue = ""; }
});

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

export function mount({ main, desk, files, privateNote }) {
  const start = async () => {
    main.innerHTML = "";
    main.append(dock({ accept: `.pdf,application/pdf,${EXT}`, multiple: true, title: "Drop the PDF you want to work on", hint: `Several? They're joined into one first. A Docket project file (${EXT}) opens with all its steps.`, onFiles: open }));
    desk.innerHTML = `<h2>Workspace</h2>
      <p>Open a PDF, then pick changes one after another. Each one opens the right tool with your document already in it, and brings the result back here. Undo any step, or go back to an earlier one.</p>
      ${keepSwitch()}
      <p class="note keep-note"></p>${privateNote()}`;
    wireKeep();
    await projectList();
  };

  // the switch, and what it means
  const keepSwitch = () => `<label class="check"><input type="checkbox" name="keep" ${store.keeping() ? "checked" : ""}> Keep my work on this device</label>`;
  function wireKeep(onChange) {
    const box = desk.querySelector("[name=keep]"), note = desk.querySelector(".keep-note");
    const explain = () => {
      if (note) note.textContent = box.checked
        ? "Your documents and every step are saved in this browser, on this device only, so you can come back to them. Turn this off on a shared computer."
        : "Nothing is kept: the Workspace is cleared when you close the tab.";
    };
    explain();
    box.addEventListener("change", async () => { store.setKeeping(box.checked); explain(); await onChange?.(box.checked); });
  }

  async function projectList() {
    if (!(await store.available())) return;
    await store.tidy().catch(() => {});
    const all = await store.list().catch(() => []);
    if (!all.length) return;
    const use = await store.usage();
    const box = h(`<section class="ws-projects" aria-label="Saved on this device">
      <div class="ws-projects-head"><h2>Saved on this device</h2>${use ? `<small>Docket uses ${bytes(use.used)} here</small>` : ""}</div>
      <ul></ul>
      <p class="note">Projects you haven't opened for ${store.FORGET_AFTER_DAYS} days are deleted unless pinned. In Safari, install Docket (Add to Dock or Home Screen) or it may clear them after a week unused.</p>
      <button type="button" class="pill ghost forget-all">Forget everything on this device</button></section>`);
    const ul = box.querySelector("ul");
    for (const p of all) {
      const li = h(`<li class="ws-project">
        <button type="button" class="ws-open"><b>${esc(p.name)}</b><small>${plural(p.count, "step")} · ${bytes(p.sizes[p.at - p.first] || 0)} · edited ${ago(p.updated)}</small></button>
        <button type="button" class="icon-btn pin" aria-pressed="${p.pinned}" aria-label="${p.pinned ? "Unpin" : "Pin"} ${esc(p.name)}" title="${p.pinned ? "Pinned: kept until you forget it" : "Pin: keep it past " + store.FORGET_AFTER_DAYS + " days"}">${svg(p.pinned ? "pinned" : "pin")}</button>
        <button type="button" class="icon-btn forget" aria-label="Forget ${esc(p.name)}" title="Delete it from this device">${svg("close")}</button></li>`);
      li.querySelector(".ws-open").addEventListener("click", async () => { if (await resume(p.id)) { savedAt = ws.at; show(); } });
      li.querySelector(".pin").addEventListener("click", async () => { await store.update(p.id, { pinned: !p.pinned, touch: false }); start(); });
      li.querySelector(".forget").addEventListener("click", async () => {
        if (!confirm(`Delete ${p.name} and its steps from this device?`)) return;
        await store.forget(p.id);
        start();
      });
      ul.append(li);
    }
    box.querySelector(".forget-all").addEventListener("click", async () => {
      if (!confirm("Delete every saved project from this device?")) return;
      await store.forgetAll();
      start();
    });
    main.append(box);
  }

  async function open(newFiles) {
    const project = newFiles.find(isProject);
    if (project) {
      try { await adopt(await fromProjectFile(await readBytes(project))); }
      catch (err) { await start(); main.prepend(h(`<p class="status bad">${esc(err.message)}</p>`)); return; }
      savedAt = ws.at;
      return show();
    }
    const pdfs = newFiles.filter(isPdf);
    if (!pdfs.length) { start(); main.append(h(`<p class="status bad">That isn't a PDF.</p>`)); return; }
    if (pdfs.length === 1) { await begin(pdfs[0]); savedAt = -1; return show(); }
    // several: join them, as Merge would, so there's one document to work on
    const { PDFDocument } = await lib();
    const out = await PDFDocument.create();
    for (const f of pdfs) {
      const src = await openForEdit(await readBytes(f));
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    }
    await begin(new File([await out.save()], "merged.pdf", { type: "application/pdf" }), `Joined ${plural(pdfs.length, "file")}`);
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
      <label class="field" style="margin-top: 18px">File name<input type="text" name="saveName" value="${esc(ws.name)}"></label>
      <button type="button" class="pill go">Download</button>
      <button type="button" class="pill ghost project-file" style="margin-top: 8px">Save project file (${EXT})</button>
      <p class="note">The project file holds every step, so you can carry on later on any device: drop it on the Workspace.</p>
      <p class="status" role="status"></p>
      <div class="ws-keep">
        <p class="ws-saved ${ws.saveError ? "bad" : ""}">${ws.saveError ? esc(ws.saveError) : ws.saved ? `${svg("check", { size: 16 })} Saved on this device, step by step` : "Not kept: closing the tab clears it"}</p>
        ${keepSwitch()}
        <button type="button" class="pill ghost close-doc">Close (it stays saved)</button>
      </div>${privateNote()}`;
    const out = desk.querySelector(".status");

    desk.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => {
      ws.pending = b.dataset.tool;
      handOff([current()]);
      location.hash = "#/" + b.dataset.tool;
    }));
    desk.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { jump(Number(b.dataset.step)); show(); }));
    const nameBox = desk.querySelector("[name=saveName]");
    const fileName = () => nameBox.value.trim().replace(/(\.pdf)?$/i, ".pdf") || "document.pdf";
    nameBox.addEventListener("change", async () => { await rename(fileName()); bar.querySelector(".ws-name b").textContent = ws.name; });
    desk.querySelector(".go").addEventListener("click", () => {
      download(current(), fileName());
      savedAt = ws.at;
      status(out, `Downloaded ${fileName()}, ${bytes(current().size)}.`, "good");
    });
    desk.querySelector(".project-file").addEventListener("click", async () => {
      const data = await toProjectFile({ name: ws.name, steps: ws.steps, at: ws.at });
      const name = ws.name.replace(/\.pdf$/i, "") + EXT;
      download(new Blob([data], { type: "application/octet-stream" }), name);
      savedAt = ws.at;
      status(out, `Saved ${name}: ${plural(ws.steps.length, "step")}, ${bytes(data.length)}.`, "good");
    });
    const closeBtn = desk.querySelector(".close-doc");
    const closeLabel = () => (closeBtn.textContent = ws.saved ? "Close (it stays saved)" : "Close");
    closeLabel();
    closeBtn.addEventListener("click", () => {
      if (!ws.saved && ws.at > 0 && savedAt !== ws.at && !confirm("This document isn't kept on the device and hasn't been downloaded. Close it anyway?")) return;
      clear();
      start();
    });
    // switching keeping on saves this document now; off forgets it from the device
    wireKeep(async (on) => {
      if (on) await keepThis(); else await forgetThis();
      show();
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

  const first = files.filter((f) => isPdf(f) || isProject(f));
  if (first.length) open(first);
  else if (active()) show();
  else start();
}
