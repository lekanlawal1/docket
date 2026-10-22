import { onePdf, h, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, openForView, drawPage, lib } from "../pdf.js";

export const intro = "Finds the empty pages, like the backs of double-sided scans, and takes them out. You see every page first and can change any choice.";

// How much of a page is ink: the share of pixels clearly darker than paper. Scanned "blank"
// pages are grey-ish and speckled, so faint tone and a few specks don't count.
function inkShare(canvas) {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] < 190) ink++;
  return ink / (data.length / 4);
}

const LEVELS = { strict: 0.0005, normal: 0.003, loose: 0.01 };   // most ink a page can have and still count as blank

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Blank pages</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const pages = [];   // { ink, chars, canvas, remove }

    desk.innerHTML = `<h2>Blank pages</h2><p class="summary-line">Looking at every page...</p>
      <label class="field">What counts as blank<select name="level">
        <option value="strict">Completely empty</option>
        <option value="normal" selected>Empty, apart from specks or a page number</option>
        <option value="loose">Nearly empty, like a faint scan</option></select></label>
      <button type="button" class="pill go" disabled>Remove ticked pages</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".summary-line");
    const grid = h(`<div class="pages"></div>`);
    main.append(h(`<p style="margin: 0 0 10px; color: var(--muted); font-size: 14px">Ticked pages will be removed. Tap a page to change it.</p>`), grid);

    for (let n = 1; n <= view.numPages; n++) {
      const { canvas, page } = await drawPage(view, n, { width: 160 });
      const chars = (await page.getTextContent()).items.map((i) => i.str).join("").replace(/\s/g, "").length;
      pages.push({ ink: inkShare(canvas), chars, canvas });
      line.textContent = `Looking at page ${n} of ${view.numPages}...`;
    }

    function decide() {
      const limit = LEVELS[desk.querySelector("[name=level]").value];
      // a page number or a stray mark has a few characters at most
      pages.forEach((p) => (p.remove = p.ink <= limit && p.chars <= 3));
      draw();
    }
    function draw() {
      grid.innerHTML = "";
      pages.forEach((p, i) => {
        const card = h(`<label class="page-card${p.remove ? " drop" : ""}" style="cursor: pointer"><span class="thumb"></span>
          <span class="label"><span>Page ${i + 1}${p.remove ? " · blank" : ""}</span><input type="checkbox" aria-label="Remove page ${i + 1}" ${p.remove ? "checked" : ""}></span></label>`);
        card.querySelector(".thumb").append(p.canvas);
        card.querySelector("input").onchange = (e) => { p.remove = e.target.checked; draw(); };
        grid.append(card);
      });
      const n = pages.filter((p) => p.remove).length;
      line.textContent = n ? `${plural(n, "page")} of ${view.numPages} ticked to remove.` : "No blank pages found. Tick any page you want removed.";
      go.disabled = !n || n === pages.length;
      if (n && n === pages.length) status(out, "Every page is ticked. Untick at least one to keep.", "bad"); else status(out, "");
    }
    desk.querySelector("[name=level]").onchange = decide;
    decide();

    go.addEventListener("click", () => busy(go, out, "Removing...", async () => {
      const { PDFDocument } = await lib();
      const src = await openForEdit(bytesIn);
      const keep = pages.map((p, i) => (p.remove ? -1 : i)).filter((i) => i >= 0);
      const doc = await PDFDocument.create();
      for (const page of await doc.copyPages(src, keep)) doc.addPage(page);
      download(await doc.save(), renamed(file, "-no-blanks", "pdf"));
      status(out, `Done: removed ${plural(pages.length - keep.length, "page")}, kept ${keep.length}.`, "good");
    }));
  } });
}
