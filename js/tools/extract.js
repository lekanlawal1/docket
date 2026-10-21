import { onePdf, h, download, renamed, plural, busy, status, thumbnails } from "../ui.js";
import { readBytes, openForEdit, openForView, lib } from "../pdf.js";
import { parseRanges, describe } from "../ranges.js";

export const intro = "Tap the pages you want, or type them, and they come out as one new PDF.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Pages to keep</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const count = view.numPages;
    const picked = new Set();

    desk.innerHTML = `<h2>Pages to keep</h2>
      <label class="field">Pages<input type="text" placeholder="e.g. 1-3, 7"><span class="note">Or tap pages on the left.</span></label>
      <p class="picked" style="font-size: 14px"></p>
      <button type="button" class="pill go" disabled>Extract</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const input = desk.querySelector("input"), go = desk.querySelector("button"), out = desk.querySelector(".status"), note = desk.querySelector(".picked");

    const grid = h(`<div class="pages"></div>`);
    main.append(grid);
    const sync = (fromTyping) => {
      grid.querySelectorAll(".page-card").forEach((c, i) => {
        c.classList.toggle("off", !picked.has(i));
        c.querySelector("input").checked = picked.has(i);
      });
      const pages = [...picked].sort((a, b) => a - b);
      if (!fromTyping) input.value = describe(pages);
      note.textContent = pages.length ? `${plural(pages.length, "page")} picked.` : "No pages picked yet.";
      go.disabled = !pages.length;
    };
    input.addEventListener("input", () => {
      try {
        picked.clear();
        if (input.value.trim()) parseRanges(input.value, count).flat().forEach((p) => picked.add(p));
        input.setCustomValidity("");
      } catch (err) { note.textContent = err.message; return; }
      sync(true);
    });
    // wired up before the thumbnails draw, since typing pages can enable the button first
    go.addEventListener("click", () => busy(go, out, "Extracting...", async () => {
      const { PDFDocument } = await lib();
      const src = await openForEdit(bytesIn);
      const pages = [...picked].sort((a, b) => a - b);
      const doc = await PDFDocument.create();
      for (const p of await doc.copyPages(src, pages)) doc.addPage(p);
      download(await doc.save(), renamed(file, `-pages-${describe(pages).replace(/, /g, "_")}`, "pdf"));
      status(out, `Done: ${plural(pages.length, "page")} in a new PDF.`, "good");
    }));

    await thumbnails(grid, view, (i, canvas) => {
      const card = h(`<label class="page-card off" style="cursor: pointer"><span class="thumb"></span>
        <span class="label"><span>Page ${i + 1}</span><input type="checkbox" aria-label="Keep page ${i + 1}"></span></label>`);
      card.querySelector(".thumb").append(canvas);
      card.querySelector("input").addEventListener("change", (e) => { e.target.checked ? picked.add(i) : picked.delete(i); sync(false); });
      return card;
    });
    sync(false);

  } });
}
