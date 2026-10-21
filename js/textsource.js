// The start for the "Read" tools: drop a PDF or a .txt file, or paste text.
// `onText(text, name)` runs whenever there's new text to work on.

import { dock, h, esc, plural } from "./ui.js";
import { readBytes, openForView, pageTexts } from "./pdf.js";

export function textSource(main, { files = [], onText }) {
  main.innerHTML = "";
  const drop = dock({ accept: ".pdf,.txt,.md,application/pdf,text/plain", title: "Drop a PDF or text file", hint: "Or paste text below.", onFiles: ([f]) => load(f) });
  const paste = h(`<label class="field" style="margin-top: 18px">Paste text instead
    <textarea rows="6" placeholder="Paste a contract, an article, meeting notes..."></textarea></label>`);
  const note = h(`<p class="status" role="status"></p>`);
  main.append(drop, paste, note);

  const area = paste.querySelector("textarea");
  let timer;
  area.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => area.value.trim() && onText(area.value, "pasted text"), 350);
  });

  async function load(file) {
    note.className = "status";
    note.textContent = `Reading ${file.name}...`;
    try {
      let text;
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        const doc = await openForView(await readBytes(file));
        const pages = await pageTexts(doc);
        await doc.destroy();
        text = pages.join("\n\n");
        const empty = pages.filter((p) => !p.trim()).length;
        note.innerHTML = `<b>${esc(file.name)}</b>: ${plural(pages.length, "page")}` +
          (empty ? `, ${plural(empty, "page")} with no text (probably scanned, so not read).` : ".");
        if (!text.trim()) { note.className = "status bad"; note.textContent = `${file.name} has no text to read. It's probably a scan.`; return; }
      } else {
        text = await file.text();
        note.innerHTML = `<b>${esc(file.name)}</b>`;
      }
      area.value = "";
      onText(text, file.name);
    } catch (err) {
      note.className = "status bad";
      note.textContent = /password|encrypt/i.test(err.message) ? "This PDF is password-protected." : `Couldn't read ${file.name}.`;
    }
  }

  const first = files[0];
  if (first) load(first);
}
