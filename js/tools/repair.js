import { onePdf, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForView, rasterize, lib } from "../pdf.js";
import { qpdfRun } from "../qpdf.js";

export const intro = "For a PDF that won't open, shows blank pages or errors: Docket rebuilds its structure, then checks every page can be read.";

// How many pages open, and how many of those can be drawn without an error.
async function health(bytes) {
  let doc;
  try { doc = await openForView(bytes); } catch { return { opens: false, pages: 0, good: 0 }; }
  let good = 0, empty = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      good++;
      if (ops.fnArray.length < 3) empty++;        // readable, but nothing is drawn on it
    } catch { /* a page that can't be read */ }
  }
  const out = { opens: true, pages: doc.numPages, good, empty };
  await doc.destroy();
  return out;
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Repair</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    desk.innerHTML = `<h2>Repair</h2><p class="summary-line">Checking the file...</p>
      <button type="button" class="pill go" disabled>Repair PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">This fixes broken structure, the usual damage from an interrupted download or a program that saved badly. If parts of the file are missing altogether, they can't be brought back.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".summary-line");
    const before = await health(bytesIn);
    line.textContent = !before.opens ? "This file doesn't open as it is." : before.good < before.pages
      ? `It opens, but ${plural(before.pages - before.good, "page")} of ${before.pages} can't be read.` : `It opens, and all ${plural(before.pages, "page")} can be read. Repairing can still fix hidden structure problems.`;
    go.disabled = false;

    // Two ways to rebuild a file, tried in turn; each result is checked by opening it
    const rebuilders = [
      // pdf-lib reads the file object by object rather than trusting its index, so a broken or
      // missing index doesn't stop it; saving writes a fresh, correct one
      async () => { const { PDFDocument } = await lib(); return (await PDFDocument.load(bytesIn, { updateMetadata: false, throwOnInvalidObject: false })).save(); },
      // a file cut short (an interrupted download) ends partway through an object: keep
      // everything up to the last complete one and rebuild from that
      async () => {
        const { PDFDocument } = await lib();
        const tail = new TextDecoder("latin1").decode(bytesIn);
        const end = tail.lastIndexOf("endobj");
        if (end < 0) throw new Error("no complete objects");
        return (await PDFDocument.load(bytesIn.slice(0, end + 6), { updateMetadata: false, throwOnInvalidObject: false })).save();
      },
      async () => (await qpdfRun(bytesIn, [])).data,
    ];

    go.addEventListener("click", () => busy(go, out, "Repairing...", async () => {
      let best = null;
      for (const rebuild of rebuilders) {
        let data;
        try { data = await rebuild(); } catch { continue; }
        const after = await health(data);
        if (!after.opens || !after.good) continue;
        if (!best || after.good > best.after.good) best = { data, after };
        // as good as it gets: every page readable, and none fewer than the original showed
        if (after.good === after.pages && after.pages >= before.pages) break;
      }
      if (best && best.after.good >= before.good) {
        download(best.data, renamed(file, "-repaired", "pdf"));
        const { good, pages, empty } = best.after;
        status(out, `Done and checked: rebuilt, and ${plural(good, "page")} of ${pages} can be read.` +
          (empty && empty > (before.empty || 0) ? ` ${plural(empty, "page")} came back empty: ${empty === 1 ? "its contents were" : "their contents were"} in the damaged part of the file.` : ""), "good");
        return;
      }
      // the structure is beyond rebuilding; if the viewer can still show pages, keep those as pictures
      if (!before.good) throw new Error("the file is too damaged to recover. Try downloading it again, or ask the sender for a fresh copy.");
      const data = await rasterize(bytesIn, { scale: 2, quality: 0.9, onPage: (i, n) => status(out, `Saving page ${i} of ${n}...`) });
      const after = await health(data);
      if (!after.good) throw new Error("the file is too damaged to recover. Try downloading it again, or ask the sender for a fresh copy.");
      download(data, renamed(file, "-repaired", "pdf"));
      status(out, `Done: the file couldn't be rebuilt, so the ${plural(after.pages, "page")} that could still be shown were saved as pictures. Their text can't be selected.`, "good");
    }));
  } });
}
