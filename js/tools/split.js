import { onePdf, download, renamed, plural, busy, status, esc } from "../ui.js";
import { readBytes, openForEdit, lib } from "../pdf.js";
import { parseRanges, chunks, describe } from "../ranges.js";
import { zip } from "../zip.js";

export const intro = "Break one PDF into several: by the ranges you type, every few pages, or one file per page.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>How to split</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    let count;
    try { count = (await openForEdit(bytesIn)).getPageCount(); }
    catch (err) { main.insertAdjacentHTML("beforeend", `<p class="status bad">${esc(err.message)}</p>`); return; }
    main.insertAdjacentHTML("beforeend", `<p>${esc(file.name)} has ${plural(count, "page")}.</p>`);

    desk.innerHTML = `<h2>How to split</h2>
      <label class="check"><input type="radio" name="mode" value="ranges" checked> Ranges I type</label>
      <label class="field">Ranges<input type="text" name="ranges" value="1-${Math.max(1, Math.ceil(count / 2))}, ${Math.min(count, Math.ceil(count / 2) + 1)}-${count}">
        <span class="note">Each range becomes its own file. Example: 1-3, 4, 5-</span></label>
      <label class="check"><input type="radio" name="mode" value="every"> Every few pages</label>
      <label class="field">Pages per file<input type="number" name="every" min="1" max="${count}" value="${Math.min(2, count)}"></label>
      <label class="check"><input type="radio" name="mode" value="each"> One file per page</label>
      <p class="plan note" style="font-size: 14px"></p>
      <button type="button" class="pill go">Split</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector("button"), out = desk.querySelector(".status"), plan = desk.querySelector(".plan");
    const groups = () => {
      const mode = desk.querySelector("[name=mode]:checked").value;
      if (mode === "each") return chunks(count, 1);
      if (mode === "every") return chunks(count, Number(desk.querySelector("[name=every]").value));
      return parseRanges(desk.querySelector("[name=ranges]").value, count);
    };
    const preview = () => {
      try {
        const g = groups();
        plan.textContent = `${plural(g.length, "file")}: ` + g.slice(0, 6).map((x) => `pages ${describe(x)}`).join("; ") + (g.length > 6 ? "; ..." : "");
        plan.style.color = ""; go.disabled = false;
      } catch (err) { plan.textContent = err.message; plan.style.color = "var(--bad)"; go.disabled = true; }
    };
    desk.addEventListener("input", preview);
    preview();

    go.addEventListener("click", () => busy(go, out, "Splitting...", async () => {
      const { PDFDocument } = await lib();
      const src = await openForEdit(bytesIn);
      const parts = [];
      for (const pages of groups()) {
        const doc = await PDFDocument.create();
        for (const p of await doc.copyPages(src, pages)) doc.addPage(p);
        parts.push({ name: renamed(file, `-pages-${describe(pages).replace(/, /g, "_")}`, "pdf"), data: await doc.save() });
      }
      if (parts.length === 1) download(parts[0].data, parts[0].name);
      else download(zip(parts), renamed(file, "-split", "zip"), "application/zip");
      status(out, `Done: ${plural(parts.length, "file")}${parts.length > 1 ? ", in one .zip" : ""}.`, "good");
    }));
  } });
}
