import { h, esc, dock, download, bytes, plural, status } from "../ui.js";
import { readBytes, openForView, pageTexts } from "../pdf.js";
import { compare, report } from "../diff.js";

export const intro = "Two versions of the same document, side by side in one list: every word that was added, removed or changed, with the page it's on. Changed numbers are flagged, since those usually matter most.";

const SHOW = 150;       // changes drawn at first; the rest wait behind a button

async function readPdf(file) {
  const doc = await openForView(await readBytes(file));
  const pages = await pageTexts(doc);
  await doc.destroy();
  return pages;
}

export function mount({ main, desk, files, privateNote }) {
  const slots = [
    { label: "Original", hint: "The earlier version", file: null, pages: null },
    { label: "New version", hint: "The one you were sent", file: null, pages: null },
  ];
  const isPdf = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
  const grid = h(`<div class="compare-slots"></div>`);
  const results = h(`<div class="changes" aria-live="polite"></div>`);
  main.append(grid, results);

  desk.innerHTML = `<h2>Compare</h2><p class="summary-line">Add both versions to see what changed.</p>
    <label class="check"><input type="checkbox" name="loose"> Ignore capitals and punctuation</label>
    <label class="check"><input type="checkbox" name="numbers"> Only show changes with numbers</label>
    <button type="button" class="pill ghost swap" style="width: 100%; margin-bottom: 10px" disabled>Swap the two</button>
    <button type="button" class="pill go" disabled>Save the changes as text</button>
    <p class="status" role="status"></p>
    <p class="honest" style="margin-top: 14px">This compares the words, not the layout: a moved picture or a new font isn't counted. Scanned pages have no words to compare; run them through Make searchable first.</p>${privateNote()}`;
  const line = desk.querySelector(".summary-line"), out = desk.querySelector(".status");
  const go = desk.querySelector(".go"), swap = desk.querySelector(".swap");
  const q = (n) => desk.querySelector(`[name=${n}]`);
  let result = null;

  function drawSlots() {
    grid.innerHTML = "";
    slots.forEach((slot, k) => {
      const box = h(`<section class="compare-slot"><h3>${slot.label}</h3></section>`);
      if (!slot.file) {
        box.append(dock({ accept: ".pdf,application/pdf", small: true, title: `Add the ${slot.label.toLowerCase()}`, hint: slot.hint, onFiles: ([f]) => load(k, f) }));
      } else {
        const empty = slot.pages ? slot.pages.filter((p) => !p.trim()).length : 0;
        box.append(h(`<div class="result"><span><b>${esc(slot.file.name)}</b> <small style="color: var(--muted)">${slot.pages ? plural(slot.pages.length, "page") : "reading..."}, ${bytes(slot.file.size)}</small>
          ${empty ? `<br><small class="warn">${plural(empty, "page")} with no text (scanned?)</small>` : ""}</span>
          <button type="button" class="pill ghost">Change</button></div>`));
        box.querySelector("button").onclick = () => { slot.file = slot.pages = null; result = null; drawSlots(); run(); };
      }
      grid.append(box);
    });
    swap.disabled = !(slots[0].file && slots[1].file);
  }

  async function load(k, file) {
    if (!isPdf(file)) { status(out, `${file.name} isn't a PDF.`, "bad"); return; }
    slots[k].file = file; slots[k].pages = null;
    drawSlots();
    try { slots[k].pages = await readPdf(file); }
    catch (err) {
      slots[k].file = null;
      status(out, /password/i.test(err.message) ? `${file.name} is password-protected. Unlock it with the Password tool first.` : `${file.name} couldn't be read.`, "bad");
    }
    drawSlots();
    run();
  }

  function run() {
    results.innerHTML = "";
    go.disabled = true;
    if (!slots[0].pages || !slots[1].pages) { line.textContent = "Add both versions to see what changed."; return; }
    if (!slots[0].pages.join("").trim() || !slots[1].pages.join("").trim()) {
      line.textContent = "";
      status(out, "One of these has no text to compare. If it's a scan, run it through Make searchable first.", "bad");
      return;
    }
    status(out, "");
    result = compare(slots[0].pages, slots[1].pages, { loose: q("loose").checked });
    const { changes, stats } = result;
    const withNumbers = changes.filter((c) => c.numbers).length;
    line.innerHTML = changes.length
      ? `<b>${plural(changes.length, "change")}</b>: ${plural(stats.removed, "word")} removed, ${plural(stats.added, "word")} added. ${withNumbers ? `<b>${withNumbers}</b> involve${withNumbers === 1 ? "s" : ""} numbers.` : ""}`
      : "<b>No differences in the words.</b> The two versions say exactly the same thing.";
    go.disabled = !changes.length;
    if (changes.length && stats.same < 0.3) status(out, `Only ${Math.round(stats.same * 100)}% of the words match. These may be different documents rather than two versions of one.`, "bad");
    draw();
  }

  function draw() {
    results.innerHTML = "";
    if (!result) return;
    const list = q("numbers").checked ? result.changes.filter((c) => c.numbers) : result.changes;
    if (!list.length) {
      if (result.changes.length) results.append(h(`<p>None of the changes involve numbers.</p>`));
      return;
    }
    const card = (c) => h(`<article class="change ${c.kind}">
      <div class="where"><span class="kind">${c.kind[0].toUpperCase() + c.kind.slice(1)}</span>
        <span>page ${c.oldPage} → page ${c.newPage}</span>${c.numbers ? `<span class="numtag">Numbers</span>` : ""}</div>
      <p>${c.before ? `<span class="ctx">…${esc(c.before)}</span> ` : ""}${c.removed ? `<del>${esc(c.removed)}</del> ` : ""}${c.added ? `<ins>${esc(c.added)}</ins> ` : ""}${c.after ? `<span class="ctx">${esc(c.after)}…</span>` : ""}</p>
    </article>`);
    list.slice(0, SHOW).forEach((c) => results.append(card(c)));
    if (list.length > SHOW) {
      const more = h(`<button type="button" class="pill ghost">Show the other ${list.length - SHOW}</button>`);
      more.onclick = () => { more.remove(); list.slice(SHOW).forEach((c) => results.append(card(c))); };
      results.append(more);
    }
  }

  q("loose").addEventListener("change", run);
  q("numbers").addEventListener("change", draw);
  swap.onclick = () => { slots.reverse(); [slots[0].label, slots[1].label] = [slots[1].label, slots[0].label]; [slots[0].hint, slots[1].hint] = [slots[1].hint, slots[0].hint]; drawSlots(); run(); };
  go.onclick = () => {
    const text = report(result, { oldName: slots[0].file.name, newName: slots[1].file.name });
    download(text, `changes-${slots[1].file.name.replace(/\.pdf$/i, "")}.txt`, "text/plain");
  };

  drawSlots();
  // two PDFs dropped on the home page: the first is taken as the original
  const pdfs = files.filter(isPdf);
  if (pdfs[0]) load(0, pdfs[0]);
  if (pdfs[1]) load(1, pdfs[1]);
}
