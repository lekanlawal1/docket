import { onePdf, h, esc, download, renamed, busy, status } from "../ui.js";
import { readBytes, openForEdit, lib } from "../pdf.js";

export const intro = "PDFs often carry the author's name, the software used and when it was made. See what's in yours, and remove it.";

const LABELS = { Title: "Title", Author: "Author", Subject: "Subject", Keywords: "Keywords", Creator: "Made with", Producer: "Saved by", CreationDate: "Created", ModDate: "Last changed" };

// The document info dictionary, read as plain strings.
async function info(doc) {
  const { PDFName, PDFDict } = await lib();
  const ref = doc.context.trailerInfo.Info;
  const dict = ref && doc.context.lookup(ref);
  const out = {};
  if (dict instanceof PDFDict) {
    for (const [key, value] of dict.entries()) {
      const name = key.asString().slice(1);
      let text = value.decodeText?.() ?? String(value);
      if (/Date$/.test(name)) text = readable(text);
      out[name] = text;
    }
  }
  const xmp = doc.catalog.get(PDFName.of("Metadata"));
  return { fields: out, xmp: !!xmp };
}

// "D:20240312093000-05'00'" -> a date people can read
function readable(d) {
  const m = String(d).match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return d;
  const date = new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0));
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Clean it</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const doc = await openForEdit(bytesIn);
    const { fields, xmp } = await info(doc);
    const rows = Object.entries(fields);
    main.append(h(`<div class="desk" style="background: var(--card); border: 1px solid var(--card-line)">
      <h2 style="font-size: 20px">What this file says about itself</h2>
      ${rows.length ? `<dl style="display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0">${rows.map(([k, v]) => `<dt style="font-weight: 600">${esc(LABELS[k] || k)}</dt><dd style="margin: 0; overflow-wrap: anywhere">${esc(v) || "<em>empty</em>"}</dd>`).join("")}</dl>` : "<p>No document details are stored.</p>"}
      ${xmp ? `<p style="margin-top: 14px">It also carries an XMP metadata block, which can repeat these details and add editing history.</p>` : ""}
    </div>`));

    desk.innerHTML = `<h2>Clean it</h2>
      <p>${rows.length || xmp ? "Removes every detail listed, and the XMP block." : "There's nothing to remove, but you can still save a clean copy."}</p>
      <button type="button" class="pill go">Remove metadata</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">This clears the document's details. Names typed in the pages themselves stay: use Redact for those.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");

    go.addEventListener("click", () => busy(go, out, "Cleaning...", async () => {
      const { PDFName, PDFDict } = await lib();
      const clean = await openForEdit(bytesIn);
      const ref = clean.context.trailerInfo.Info;
      const dict = ref && clean.context.lookup(ref);
      if (dict instanceof PDFDict) for (const key of dict.keys()) dict.delete(key);
      clean.catalog.delete(PDFName.of("Metadata"));
      const data = await clean.save();
      // read it back to make sure nothing came back on save
      const after = await info(await openForEdit(data));
      const left = Object.entries(after.fields).filter(([, v]) => v);
      if (left.length || after.xmp) throw new Error("some details survived saving, so nothing was downloaded.");
      download(data, renamed(file, "-clean", "pdf"));
      status(out, "Done and checked: no document details left.", "good");
    }));
  } });
}
