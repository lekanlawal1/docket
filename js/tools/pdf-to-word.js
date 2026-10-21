import { onePdf, h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForView, viewer } from "../pdf.js";
import { paragraphs } from "../layout.js";
import { docx } from "../docx.js";

export const intro = "The text of a PDF as an editable Word document, with its headings, paragraphs, lists and bold or italic kept.";

// Every piece of text on a page with its position, size and style, for layout.js.
async function readPage(view, n, Util) {
  const page = await view.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  // drawing instructions load the fonts, and the fonts' real names say which are bold or italic
  await page.getOperatorList();
  const { items } = await page.getTextContent();
  const styleOf = (id) => {
    try {
      const f = page.commonObjs.get(id);
      const name = f?.name || "";
      return { bold: !!f?.bold || /bold|black|heavy|semibold|demi/i.test(name), italic: !!f?.italic || /italic|oblique/i.test(name) };
    } catch { return { bold: false, italic: false }; }
  };

  const shown = [], own = [];
  let upright = 0;
  for (const it of items) {
    if (!it.str) continue;
    const style = styleOf(it.fontName);
    // as shown on screen, which is what matters for pages with /Rotate set
    const m = Util.transform(vp.transform, it.transform);
    if (Math.abs(m[1]) < Math.abs(m[0]) * 0.05 && m[0] > 0) upright++;
    shown.push({ str: it.str, x: m[4], y: m[5], size: Math.hypot(m[2], m[3]), width: it.width, ...style });
    // as drawn on the page itself, for pages whose text only runs straight before rotating
    const t = it.transform;
    own.push({ str: it.str, x: t[4], y: vp.viewBox[3] - t[5], size: Math.hypot(t[2], t[3]), width: it.width, ...style });
  }
  const useView = upright >= items.length / 2;
  const [, , w, hgt] = vp.viewBox;
  return { width: useView ? vp.width : w, height: useView ? vp.height : hgt, items: useView ? shown : own };
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>To Word</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const { Util } = await viewer();
    const pages = [];
    for (let n = 1; n <= view.numPages; n++) pages.push(await readPage(view, n, Util));
    const empty = pages.map((p, i) => (p.items.some((x) => x.str.trim()) ? 0 : i + 1)).filter(Boolean);

    desk.innerHTML = `<h2>To Word</h2>
      <p>${plural(view.numPages, "page")}.${empty.length ? ` ${empty.length === view.numPages ? "None of them have" : `Page${empty.length > 1 ? "s" : ""} ${empty.join(", ")} ${empty.length > 1 ? "have" : "has"}`} any text: ${empty.length > 1 ? "they're" : "it's"} probably scanned. Run <a href="#/searchable">Make searchable</a> first, then convert that.` : ""}</p>
      <label class="check"><input type="checkbox" name="breaks"> Start each PDF page on a new page</label>
      <p class="honest">You get the words and their structure: headings, paragraphs, lists, bold and italic. Pictures aren't carried over, tables come out as text separated by tabs, and the exact layout won't match. Check the preview before you rely on it.</p>
      <button type="button" class="pill go" ${empty.length === view.numPages ? "disabled" : ""}>Save as Word</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");

    const result = paragraphs(pages);
    const preview = h(`<div class="out-text doc-preview" aria-label="Preview"></div>`);
    preview.innerHTML = result.slice(0, 80).map((p) => {
      const inner = p.runs.map((r) => {
        let t = esc(r.text).replace(/\t/g, " &nbsp; ");
        if (r.bold && !p.heading) t = `<b>${t}</b>`;
        if (r.italic) t = `<i>${t}</i>`;
        return t;
      }).join("");
      return p.heading ? `<h${p.heading + 1}>${inner}</h${p.heading + 1}>` : `<p${p.list ? ' class="li"' : ""}>${inner}</p>`;
    }).join("") + (result.length > 80 ? `<p><em>... and ${plural(result.length - 80, "more paragraph")}.</em></p>` : "");
    if (result.length) main.append(h(`<p style="margin: 0 0 8px; color: var(--muted); font-size: 14px">Preview</p>`), preview);

    go.addEventListener("click", () => busy(go, out, "Writing...", async () => {
      const breaks = desk.querySelector("[name=breaks]").checked;
      let lastPage = 0;
      const paras = result.map((p) => {
        const brk = breaks && p.page > lastPage;
        lastPage = p.page;
        return brk ? { ...p, pageBreakBefore: true } : p;
      });
      const first = pages.find((p) => p.items.length) || { width: 612, height: 792 };
      const title = (await view.getMetadata()).info?.Title || file.name.replace(/\.pdf$/i, "");
      const data = docx(paras, { title, page: { width: first.width, height: first.height } });
      download(data, renamed(file, "", "docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const heads = paras.filter((p) => p.heading).length;
      status(out, `Done: ${plural(paras.length, "paragraph")}${heads ? `, ${plural(heads, "heading")}` : ""}.`, "good");
    }));
  } });
}
