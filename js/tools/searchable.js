import { onePdf, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, openForView, pageTexts } from "../pdf.js";
import { reader, pageForReading, addTextLayer, turned } from "../ocr.js";

export const intro = "Scanned pages are just pictures of text. This reads them and adds the words behind each page, so you can search, select and copy, while the page looks exactly the same.";

async function read(worker, canvas, turn) {
  const { data } = await worker.recognize(canvas);
  const found = data.words.filter((w) => w.text.trim() && w.confidence > 20);
  // text read the wrong way round comes out as lots of one-character "words" at middling
  // confidence, so count only confident, word-like results
  const score = found.filter((w) => w.confidence >= 75 && /[A-Za-z]{3}|\d{2}/.test(w.text)).length;
  return { data, found, turn, score };
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Read the scan</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const texts = await pageTexts(view);
    // a page with a few stray characters (a page number, a stamp) still counts as a scan
    const scanned = texts.map((t, i) => (t.replace(/\s/g, "").length < 20 ? i : -1)).filter((i) => i >= 0);

    desk.innerHTML = `<h2>Read the scan</h2>
      <p>${scanned.length
        ? `${plural(scanned.length, "page")} of ${view.numPages} ${scanned.length === 1 ? "is a scan" : "are scans"} with no text to search.`
        : "Every page already has text, so there's nothing to read. Try Find or PDF to text instead."}</p>
      <p class="honest">Reads English, printed text. Handwriting, very small print and photos taken at an angle come out poorly.
      The first time, this downloads the reader (about 7 MB); after that it's cached. It takes a few seconds a page, longer on phones.</p>
      <button type="button" class="pill go" ${scanned.length ? "" : "disabled"}>Make searchable</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");

    go.addEventListener("click", () => busy(go, out, "Reading...", async () => {
      let pageAt = 0;
      status(out, "Getting the reader ready...");
      const worker = await reader((m) => {
        if (/loading|initializ/i.test(m.status) && !pageAt) status(out, "Getting the reader ready (a one-time download)...");
        if (m.status === "recognizing text" && pageAt) status(out, `Reading page ${pageAt} of ${scanned.length}: ${Math.round(m.progress * 100)}%`);
      });

      const doc = await openForEdit(bytesIn);
      let words = 0, confidence = 0, weak = [];
      for (const i of scanned) {
        pageAt++;
        const { canvas, viewport } = await pageForReading(view, i + 1);
        let best = await read(worker, canvas, 0);
        // a page scanned sideways or upside down reads as nonsense, so try the other ways round
        for (const turn of [90, 270, 180]) {
          if (best.score >= 10 && best.data.confidence >= 70) break;
          const attempt = await read(worker, turned(canvas, turn), turn);
          if (attempt.score > best.score) best = attempt;
        }
        const { data, found } = best;
        words += await addTextLayer(doc, doc.getPage(i), found, viewport, best.turn);
        confidence += data.confidence;
        if (found.length && data.confidence < 60) weak.push(i + 1);
        canvas.width = canvas.height = 0;            // free the memory before the next page
      }
      const data = await doc.save();

      // read the new file back the way any PDF app would
      const check = await openForView(data);
      const after = await pageTexts(check);
      await check.destroy();
      const nowReadable = scanned.filter((i) => after[i].trim()).length;
      if (!words || !nowReadable) {
        status(out, "No text could be read on these pages. They may be photos, handwriting, or too blurry.", "bad");
        return;
      }
      download(data, renamed(file, "-searchable", "pdf"));
      const avg = Math.round(confidence / scanned.length);
      status(out, `Done: ${plural(words, "word")} read on ${plural(nowReadable, "page")}, ${avg}% confident on average.` +
        (weak.length ? ` Page${weak.length > 1 ? "s" : ""} ${weak.join(", ")} came out unsure, so check ${weak.length > 1 ? "them" : "it"} before relying on the text.` : ""), "good");
    }));
  } });
}
