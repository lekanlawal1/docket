// Filling a form that has no form fields: a scan, a photo, or a PDF made from a picture.
// Docket finds the blanks and tick boxes on each page (js/formfind.js), puts a box over each
// to type in or tick, and lets you add any it missed or remove any it got wrong. The result is
// saved either with the answers written onto the page, or as a real fillable PDF.

import { h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, drawPage, viewports, uprightRect, uprightPoint, lib } from "../pdf.js";
import { findBlanks } from "../formfind.js";

const DETECT_WIDTH = 1400;   // pixels across the page when looking for blanks
const INK = [0.05, 0.1, 0.35];  // dark blue, like a pen
// one size for a blank's text, on screen and saved: most of the line's height, at most 13 pt
const textSize = (f, v) => Math.min(f.h * v.height * 0.68, 13);
// On a phone a blank on the page is a few pixels tall, so typing happens in a panel instead
const PHONE = "(max-width: 720px)";
// A tick box is empty, ticked or crossed: each tap moves it on to the next
const TICKS = { tick: [[[0.2, 0.55], [0.42, 0.78], [0.82, 0.24]]], cross: [[[0.2, 0.2], [0.8, 0.8]], [[0.8, 0.2], [0.2, 0.8]]] };
const NEXT_MARK = { "": "tick", tick: "cross", cross: "" };
const SAYS = { "": "empty", tick: "ticked", cross: "crossed" };

// How a fillable tick box looks when on: the same strokes as written-on marks, in the widget's own space.
function drawnMark(P, mark) {
  const { pushGraphicsState, popGraphicsState, setLineWidth, setLineCap, setStrokingRgbColor, moveTo, lineTo, stroke, LineCapStyle } = P;
  return (_, widget) => {
    const { width: w, height: hh } = widget.getRectangle();
    const ops = [pushGraphicsState(), setStrokingRgbColor(...INK), setLineWidth(Math.max(0.8, hh * 0.12)), setLineCap(LineCapStyle.Round)];
    for (const line of TICKS[mark]) {
      ops.push(moveTo(line[0][0] * w, (1 - line[0][1]) * hh));
      for (const [x, y] of line.slice(1)) ops.push(lineTo(x * w, (1 - y) * hh));
      ops.push(stroke());
    }
    ops.push(popGraphicsState());
    return { normal: { on: ops, off: [] } };
  };
}

export async function flatForm({ main, desk, file, bytesIn, privateNote }) {
  const view = await openForView(bytesIn);
  const vps = await viewports(view);
  const pages = [];   // { canvas, fields: [{ kind, x, y, w, h, value, mark }] }

  desk.innerHTML = `<h2>Fill in</h2><p class="summary-line">Looking for the blanks…</p>`;
  for (let n = 1; n <= view.numPages; n++) {
    desk.querySelector(".summary-line").textContent = `Looking for the blanks on page ${n} of ${view.numPages}…`;
    const { canvas } = await drawPage(view, n, { width: DETECT_WIDTH });
    const fields = findBlanks(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)).map((f) => ({ ...f, value: "", mark: "" }));
    pages.push({ canvas, fields });
  }
  const count = (k) => pages.reduce((n, p) => n + p.fields.filter((f) => f.kind === k).length, 0);

  let pageNo = 0, mode = null;   // mode: null, "text" or "check" while adding by hand
  const toolbar = h(`<div class="flat-tools" role="toolbar" aria-label="Form tools">
    <button type="button" class="pill ghost small" data-mode="text" aria-pressed="false">${svg("plus", { size: 16 })} Add a text box</button>
    <button type="button" class="pill ghost small" data-mode="check" aria-pressed="false">${svg("plus", { size: 16 })} Add a tick box</button>
    <span class="flat-hint"></span></div>`);
  const pager = h(`<div class="pager"><button type="button" class="icon-btn" aria-label="Previous page">${svg("left")}</button><span></span><button type="button" class="icon-btn" aria-label="Next page">${svg("right")}</button></div>`);
  const stage = h(`<div class="stage flat-stage"></div>`);
  main.append(toolbar);
  if (pages.length > 1) main.append(pager);
  // on a phone the page stays wide enough to type into, and scrolls sideways
  const scroller = h(`<div class="flat-scroll"></div>`);
  scroller.append(stage);
  main.append(scroller);
  const sheet = h(`<div class="flat-sheet" role="dialog" aria-label="Fill in a blank" hidden>
    <canvas class="flat-peek" aria-hidden="true"></canvas>
    <label><span class="where"></span><input type="text" enterkeyhint="next" autocomplete="off"></label>
    <div class="flat-sheet-row">
      <button type="button" class="pill ghost small" data-go="-1">${svg("left", { size: 16 })} Back</button>
      <button type="button" class="pill ghost small" data-go="1">Next ${svg("right", { size: 16 })}</button>
      <button type="button" class="pill small done">Done</button>
    </div></div>`);
  main.append(sheet);
  const [prev, next] = pager.querySelectorAll("button");
  prev.onclick = () => { if (pageNo > 0) { closeSheet(); pageNo--; show(); } };
  next.onclick = () => { if (pageNo < pages.length - 1) { closeSheet(); pageNo++; show(); } };

  desk.innerHTML = `<h2>Fill in</h2>
    <p class="summary-line">This form has no fillable boxes, so Docket found where to write: ${plural(count("text"), "blank")} and ${plural(count("check"), "tick box", "tick boxes")}${pages.length > 1 ? ` on ${plural(pages.length, "page")}` : ""}.</p>
    <p class="note">Check them over: add any it missed with the buttons above the page, and remove any that are wrong with ×.</p>
    <p class="note">Tap a tick box once for ✓, again for ✕, and a third time to empty it.</p>
    <button type="button" class="pill go">Save filled PDF</button>
    <button type="button" class="pill ghost fillable" style="margin-top: 8px">Save as a fillable PDF</button>
    <p class="note">A fillable PDF has real form fields, with your answers in them, so it can be filled in or changed in any PDF app.</p>
    <p class="status" role="status"></p>${privateNote()}`;
  const out = desk.querySelector(".status");
  const hint = toolbar.querySelector(".flat-hint");

  toolbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    mode = mode === b.dataset.mode ? null : b.dataset.mode;
    toolbar.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === mode)));
    stage.classList.toggle("adding", !!mode);
    hint.textContent = mode ? `Tap the page where the ${mode === "text" ? "text" : "tick box"} goes.` : "";
  });

  // tapping the page (not a box) while adding puts a new one there
  stage.addEventListener("click", (e) => {
    if (!mode || e.target.closest(".flat-field")) return;
    const r = stage.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const aspect = r.width / r.height;
    const field = mode === "text"
      ? { kind: "text", x: Math.min(fx, 0.75), y: Math.max(0, fy - 0.012 * aspect), w: 0.25, h: 0.02 * aspect, value: "", mark: "" }
      : { kind: "check", x: fx - 0.008, y: fy - 0.008 * aspect, w: 0.016, h: 0.016 * aspect, value: "", mark: "" };
    pages[pageNo].fields.push(field);
    toolbar.querySelector(`[data-mode="${mode}"]`).click();   // one at a time: back to filling in
    show();
    if (field.kind === "text" && matchMedia(PHONE).matches) openSheet(field);
    else stage.querySelector(`.flat-field:last-of-type input`)?.focus();
  });

  function show() {
    pager.querySelector("span").textContent = `Page ${pageNo + 1} of ${pages.length}`;
    prev.disabled = pageNo === 0; next.disabled = pageNo === pages.length - 1;
    stage.innerHTML = "";
    stage.append(pages[pageNo].canvas);
    const nth = { text: 0, check: 0 };
    pages[pageNo].fields.forEach((f, i) => {
      const k = ++nth[f.kind];
      const box = h(`<div class="flat-field ${f.kind}"></div>`);
      Object.assign(box.style, { left: f.x * 100 + "%", top: f.y * 100 + "%", width: f.w * 100 + "%", height: f.h * 100 + "%" });
      if (f.kind === "text") {
        const input = h(`<input type="text" data-i="${i}" aria-label="Blank ${k} on page ${pageNo + 1}" value="${esc(f.value)}">`);
        input.addEventListener("input", () => (f.value = input.value));
        // on a phone the tiny box only opens the panel; no keyboard for it
        if (matchMedia(PHONE).matches) {
          input.readOnly = true;
          input.addEventListener("click", () => openSheet(f));
        }
        if (f === editing) box.classList.add("on");
        box.append(input);
      } else {
        const btn = h(`<button type="button" class="tick" data-mark="${f.mark}"></button>`);
        const say = () => btn.setAttribute("aria-label", `Tick box ${k} on page ${pageNo + 1}: ${SAYS[f.mark]}`);
        say();
        btn.addEventListener("click", () => { f.mark = NEXT_MARK[f.mark]; btn.dataset.mark = f.mark; say(); });
        box.append(btn);
      }
      const x = h(`<button type="button" class="x" aria-label="Remove this ${f.kind === "text" ? "box" : "tick box"}">×</button>`);
      x.addEventListener("click", () => { if (f === editing) closeSheet(); pages[pageNo].fields.splice(pages[pageNo].fields.indexOf(f), 1); show(); });
      box.append(x);
      stage.append(box);
    });
    sizeText();
  }

  // typed text is the size it will be on the saved page, scaled to the page on screen
  function sizeText() {
    const scale = stage.getBoundingClientRect().width / vps[pageNo].width;
    stage.querySelectorAll(".flat-field.text input").forEach((el) => {
      const f = pages[pageNo].fields[Number(el.dataset.i)];
      el.style.fontSize = Math.max(6, textSize(f, vps[pageNo])) * scale + "px";
    });
  }
  new ResizeObserver(sizeText).observe(stage);
  matchMedia(PHONE).addEventListener("change", () => { closeSheet(); show(); });

  // ---- the phone panel: one blank at a time, with a close-up of where it is on the page
  let editing = null;
  const sheetInput = sheet.querySelector("input");
  const blanks = () => pages.flatMap((p, n) => p.fields.filter((f) => f.kind === "text").map((f) => ({ f, n })));
  function openSheet(f) {
    const all = blanks(), at = all.findIndex((b) => b.f === f);
    if (at < 0) return;
    if (all[at].n !== pageNo) pageNo = all[at].n;
    editing = f;
    show();
    sheet.hidden = false;
    sheet.querySelector(".where").textContent = `Blank ${at + 1} of ${all.length}${pages.length > 1 ? `, page ${pageNo + 1}` : ""}`;
    sheet.querySelector("[data-go='-1']").disabled = at === 0;
    sheet.querySelector("[data-go='1']").disabled = at === all.length - 1;
    sheetInput.value = f.value;
    sheetInput.enterKeyHint = at === all.length - 1 ? "done" : "next";
    peek(f);
    sheetInput.focus();   // in the same tap, so phones open the keyboard
    stage.querySelector(".flat-field.on")?.scrollIntoView({ block: "center", inline: "center" });
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    editing = null;
    stage.querySelector(".flat-field.on")?.classList.remove("on");
    sheetInput.blur();
  }
  // the label and line around the blank, drawn big enough to read
  function peek(f) {
    const src = pages[pageNo].canvas, c = sheet.querySelector(".flat-peek");
    // about 45% of the page across: the label before the blank and the start of it, readable on a phone
    const x0 = Math.max(0, Math.min(f.x - 0.2, 0.55)), x1 = Math.min(1, x0 + 0.45);
    const y0 = Math.max(0, f.y - f.h * 0.9), y1 = Math.min(1, f.y + f.h * 1.4);
    const sw = (x1 - x0) * src.width, sh = (y1 - y0) * src.height;
    c.width = Math.round(sw); c.height = Math.round(sh);
    const ctx = c.getContext("2d");
    ctx.drawImage(src, x0 * src.width, y0 * src.height, sw, sh, 0, 0, c.width, c.height);
    // the blank itself, tinted as on the page
    ctx.fillStyle = "rgba(80, 140, 255, .22)";
    ctx.fillRect((f.x - x0) * src.width, (f.y - y0) * src.height, f.w * src.width, f.h * src.height);
  }
  sheetInput.addEventListener("input", () => {
    if (!editing) return;
    editing.value = sheetInput.value;
    const on = stage.querySelector(".flat-field.on input");
    if (on) on.value = sheetInput.value;
  });
  const step = (d) => {
    const all = blanks(), at = all.findIndex((b) => b.f === editing);
    if (all[at + d]) openSheet(all[at + d].f); else closeSheet();
  };
  sheet.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) step(Number(go.dataset.go));
    if (e.target.closest(".done")) closeSheet();
  });
  sheetInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); step(1); } });
  // keep the panel above the on-screen keyboard
  const lift = () => { const v = visualViewport; sheet.style.bottom = Math.max(0, innerHeight - v.height - v.offsetTop) + "px"; };
  visualViewport?.addEventListener("resize", lift);
  visualViewport?.addEventListener("scroll", lift);
  show();

  // ---- saving
  async function build(fillable) {
    const P = await lib();
    const { StandardFonts, LineCapStyle, rgb, degrees } = P;
    const doc = await openForEdit(bytesIn);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const safe = (t) => { try { font.encodeText(t); return t; } catch { return t.normalize("NFKD").replace(/[^\x20-\x7E]/g, ""); } };
    const form = fillable ? doc.getForm() : null;
    let written = 0, ticked = 0;
    pages.forEach((p, i) => {
      const page = doc.getPage(i), v = vps[i];
      p.fields.forEach((f, k) => {
        const r = uprightRect(v, f);
        if (fillable) {
          // no border or background: the form's own lines and boxes show through
          const opts = { x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.rotate), borderWidth: 0, backgroundColor: undefined, borderColor: undefined, textColor: rgb(...INK) };
          if (f.kind === "text") {
            const field = form.createTextField(`page${i + 1}.blank${k + 1}`);
            if (f.value) { field.setText(safe(f.value)); written++; }
            field.addToPage(page, { ...opts, font });
            field.setFontSize(0);   // auto size, so long answers fit
          } else {
            const field = form.createCheckBox(`page${i + 1}.tick${k + 1}`);
            field.addToPage(page, opts);
            // a crossed box stays a cross when the fillable PDF is opened; on turned pages the
            // PDF app's own tick is used
            if (f.mark === "cross" && !r.rotate) field.updateAppearances(drawnMark(P, "cross"));
            if (f.mark) { field.check(); ticked++; }
          }
          return;
        }
        if (f.kind === "text" && f.value.trim()) {
          const text = safe(f.value.trim());
          // shrunk to fit if the answer is longer than the blank
          const inset = 0.004 * v.width;   // a little in from the start of the line, and the end
          const size = Math.max(5, Math.min(textSize(f, v), (r.width - 2 * inset) / Math.max(0.01, font.widthOfTextAtSize(text, 1))));
          const at = uprightPoint(v, f.x + 0.004, f.y + f.h * 0.78);
          page.drawText(text, { x: at.x, y: at.y, size, font, color: rgb(...INK), rotate: degrees(at.rotate) });
          written++;
        } else if (f.kind === "check" && f.mark) {
          const thickness = Math.max(0.8, r.height * 0.12);
          for (const stroke of TICKS[f.mark]) for (let s = 1; s < stroke.length; s++) {
            const a = uprightPoint(v, f.x + stroke[s - 1][0] * f.w, f.y + stroke[s - 1][1] * f.h);
            const b = uprightPoint(v, f.x + stroke[s][0] * f.w, f.y + stroke[s][1] * f.h);
            page.drawLine({ start: a, end: b, thickness, color: rgb(...INK), lineCap: LineCapStyle.Round });
          }
          ticked++;
        }
      });
    });
    return { data: await doc.save(), written, ticked };
  }

  desk.querySelector(".go").addEventListener("click", (e) => busy(e.currentTarget, out, "Saving...", async () => {
    const { data, written, ticked } = await build(false);
    download(data, renamed(file, "-filled", "pdf"));
    status(out, `Done: ${plural(written, "answer")} written and ${plural(ticked, "box", "boxes")} marked.`, "good");
  }));
  desk.querySelector(".fillable").addEventListener("click", (e) => busy(e.currentTarget, out, "Saving...", async () => {
    const { data } = await build(true);
    download(data, renamed(file, "-fillable", "pdf"));
    status(out, `Done: a fillable PDF with ${plural(count("text"), "text field")} and ${plural(count("check"), "tick box", "tick boxes")}.`, "good");
  }));
}
