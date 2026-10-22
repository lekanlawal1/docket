import { onePdf, h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForView, viewer } from "../pdf.js";
import { readPage } from "../pagetext.js";
import { paragraphs, textRows } from "../layout.js";
import { xlsx, csv, asNumber } from "../xlsx.js";

export const intro = "The tables in a PDF as a spreadsheet, one sheet per table, with amounts and percentages turned into real numbers you can add up.";

const cellText = (runs) => runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>To Excel</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const view = await openForView(await readBytes(file));
    const pdfjs = await viewer();
    const pages = [];
    for (let n = 1; n <= view.numPages; n++) pages.push(await readPage(view, n, pdfjs, { pictures: false }));
    const hasText = pages.some((p) => p.items.some((i) => i.str.trim()));

    // the two ways to read it: just the tables, or every line of text
    const tables = paragraphs(pages).filter((p) => p.table).map((p, k, all) => {
      const onPage = all.filter((q) => q.page === p.page);
      const label = onPage.length > 1 ? `Page ${p.page + 1} table ${onPage.indexOf(p) + 1}` : `Page ${p.page + 1}`;
      return { name: label, rows: p.table.rows.map((r) => r.map(cellText)) };
    });
    const lines = textRows(pages).map((rows, k) => ({ name: `Page ${k + 1}`, rows })).filter((s) => s.rows.length);

    desk.innerHTML = `<h2>To Excel</h2>
      <p class="summary-line">${!hasText ? "This PDF has no text to read. If it's a scan, run it through <a href=\"#/searchable\">Make searchable</a> first."
        : tables.length ? `Found ${plural(tables.length, "table")} on ${plural(new Set(tables.map((t) => t.name.split(" table")[0])).size, "page")}.`
        : "No tables found that line up cleanly. You can still take every line of text, split into cells."}</p>
      <label class="check"><input type="radio" name="mode" value="tables" ${tables.length ? "checked" : "disabled"}> Just the tables, one sheet each</label>
      <label class="check"><input type="radio" name="mode" value="lines" ${tables.length ? "" : "checked"}> Every line of text, one sheet per page</label>
      <button type="button" class="pill go" ${hasText ? "" : "disabled"}>Save as Excel</button>
      <button type="button" class="pill ghost csv" style="width: 100%; margin-top: 10px" ${hasText ? "" : "disabled"}>Save as CSV</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">Tables are found from how the text lines up. Merged cells and text wrapped inside a cell can split across rows, so check the preview. Amounts like $1,450.00 and 12% are saved as numbers.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const mode = () => desk.querySelector("[name=mode]:checked")?.value;
    const sheets = () => (mode() === "tables" ? tables : lines);

    const preview = h(`<div class="sheet-preview"></div>`);
    main.append(preview);
    function draw() {
      const list = sheets();
      preview.innerHTML = list.slice(0, 12).map((s) => {
        const width = Math.max(...s.rows.map((r) => r.length));
        return `<section><h3>${esc(s.name)}</h3><div class="sheet-scroll"><table class="pv-table">${s.rows.slice(0, 12).map((r, i) =>
          `<tr>${Array.from({ length: width }, (_, c) => { const t = r[c] ?? ""; const tag = i === 0 && mode() === "tables" ? "th" : "td";
            return `<${tag}${i && asNumber(t) ? ' class="num"' : ""}>${esc(t)}</${tag}>`; }).join("")}</tr>`).join("")}</table></div>
          ${s.rows.length > 12 ? `<p class="more">... and ${plural(s.rows.length - 12, "more row")}</p>` : ""}</section>`;
      }).join("") + (list.length > 12 ? `<p class="more">... and ${plural(list.length - 12, "more sheet")}</p>` : "");
    }
    desk.addEventListener("change", draw);
    draw();

    go.addEventListener("click", () => busy(go, out, "Writing...", async () => {
      const list = sheets();
      download(xlsx(list), renamed(file, "", "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const numbers = list.reduce((n, s) => n + s.rows.slice(1).flat().filter((t) => asNumber(t)).length, 0);
      status(out, `Done: ${plural(list.length, "sheet")}, ${plural(numbers, "number")} saved as numbers.`, "good");
    }));
    desk.querySelector(".csv").onclick = () => {
      // one CSV holds one sheet, so sheets are stacked with a blank line and their name between
      const rows = sheets().flatMap((s, i) => [...(i ? [[]] : []), ...(sheets().length > 1 ? [[s.name]] : []), ...s.rows]);
      download(csv(rows), renamed(file, "", "csv"), "text/csv");
    };
  } });
}
