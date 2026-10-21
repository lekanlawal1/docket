import { onePdf, h, download, renamed, plural, status } from "../ui.js";
import { readBytes, openForView, pageTexts } from "../pdf.js";

export const intro = "Copy the words out of a PDF. Scanned pages are pictures, so they have no text to copy.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>The text</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const view = await openForView(await readBytes(file));
    const pages = await pageTexts(view);
    const empty = pages.filter((t) => !t.trim()).length;
    const text = pages.map((t, i) => (pages.length > 1 ? `--- Page ${i + 1} ---\n` : "") + t).join("\n\n");
    const words = (text.match(/\S+/g) || []).length;

    const box = h(`<textarea class="out-text" style="width: 100%; min-height: 420px; font: inherit" aria-label="Text from the PDF" readonly></textarea>`);
    box.value = text;
    main.append(box);

    desk.innerHTML = `<h2>The text</h2>
      <p>${plural(pages.length, "page")}, about ${plural(words, "word")}.${empty ? ` ${plural(empty, "page")} had no text: probably scanned. <a href="#/searchable">Make searchable</a> can read ${empty === 1 ? "it" : "them"}.` : ""}</p>
      <button type="button" class="pill go copy">Copy all</button>
      <button type="button" class="pill ghost save" style="width: 100%; margin-top: 10px">Save as .txt</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const out = desk.querySelector(".status");
    desk.querySelector(".copy").onclick = async () => {
      try { await navigator.clipboard.writeText(box.value); status(out, "Copied.", "good"); }
      catch { box.select(); status(out, "Select all and copy with Ctrl+C (Cmd+C on a Mac)."); }
    };
    desk.querySelector(".save").onclick = () => download(box.value, renamed(file, "", "txt"), "text/plain;charset=utf-8");
  } });
}
