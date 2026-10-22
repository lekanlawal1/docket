import { onePdf, h, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, drawPage, viewports, uprightRect, uprightPoint, pageTexts, lib } from "../pdf.js";

export const intro = "Type on any PDF, even one without form boxes. Highlight, white out, and tick or cross boxes, then save.";

const TOOLS = [
  { id: "text", label: "Text", hint: "Tap where the text should start, then type." },
  { id: "highlight", label: "Highlight", hint: "Drag across what you want highlighted." },
  { id: "whiteout", label: "White-out", hint: "Drag over what you want covered." },
  { id: "check", label: "✓", aria: "Tick", hint: "Tap to place a tick." },
  { id: "cross", label: "✗", aria: "Cross", hint: "Tap to place a cross." },
];
const COLOURS = { black: [0.1, 0.1, 0.12], blue: [0.1, 0.25, 0.65], red: [0.75, 0.12, 0.1] };
const css = (c) => `rgb(${COLOURS[c].map((v) => Math.round(v * 255)).join(",")})`;
// where the first line's baseline sits below the top of a text box, and the gap between lines,
// as fractions of the font size; the on-screen box uses the same, so what you see is what saves
const BASELINE = 0.95, LINE = 1.2;
// a tick and a cross, as points inside their square (0..1)
const STROKES = { check: [[[0.12, 0.55], [0.4, 0.82], [0.88, 0.18]]], cross: [[[0.18, 0.18], [0.82, 0.82]], [[0.82, 0.18], [0.18, 0.82]]] };

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Add text and marks</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const vps = await viewports(view);
    const items = [];          // { page, type, x, y, w, h (fractions of the page), text, size, colour }
    let pageNo = 1, tool = "text", selected = null;

    desk.innerHTML = `<h2>Add text and marks</h2>
      <div class="tool-pick" role="radiogroup" aria-label="What to add">
        ${TOOLS.map((t) => `<button type="button" class="pill${t.id === tool ? "" : " ghost"}" data-tool="${t.id}" role="radio" aria-checked="${t.id === tool}"${t.aria ? ` aria-label="${t.aria}"` : ""}>${t.label}</button>`).join("")}
      </div>
      <p class="tool-hint" style="font-size: 14px"></p>
      <div style="display: flex; gap: 10px">
        <label class="field" style="flex: 1">Size<select name="size">${[9, 10, 11, 12, 14, 16, 20, 24, 32].map((s) => `<option value="${s}"${s === 12 ? " selected" : ""}>${s} pt</option>`).join("")}</select></label>
        <label class="field" style="flex: 1">Colour<select name="colour"><option value="black">Black</option><option value="blue">Blue</option><option value="red">Red</option></select></label>
      </div>
      <button type="button" class="pill ghost undo" style="width: 100%; margin-bottom: 10px" disabled>Undo</button>
      <button type="button" class="pill go" disabled>Save PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">White-out only covers things up: the text underneath is still in the file. To remove text for real, use <a href="#/redact">Redact</a>.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), undo = desk.querySelector(".undo");
    const hint = desk.querySelector(".tool-hint");
    const sizeSel = desk.querySelector("[name=size]"), colourSel = desk.querySelector("[name=colour]");

    const pickTool = (id) => {
      tool = id;
      desk.querySelectorAll("[data-tool]").forEach((b) => { const on = b.dataset.tool === id; b.classList.toggle("ghost", !on); b.setAttribute("aria-checked", on); });
      hint.textContent = TOOLS.find((t) => t.id === id).hint;
    };
    desk.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => pickTool(b.dataset.tool)));
    pickTool("text");

    const pager = h(`<div class="pager"><button type="button" class="icon-btn" aria-label="Previous page">${svg("left")}</button><span></span><button type="button" class="icon-btn" aria-label="Next page">${svg("right")}</button></div>`);
    const stage = h(`<div class="stage annotate"></div>`);
    main.append(pager, stage);
    const [prev, next] = pager.querySelectorAll("button");
    prev.onclick = () => { if (pageNo > 1) { pageNo--; show(); } };
    next.onclick = () => { if (pageNo < view.numPages) { pageNo++; show(); } };

    const vp = () => vps[pageNo - 1];
    const pxPerPt = () => stage.clientWidth / vp().width;

    async function show() {
      pager.querySelector("span").textContent = `Page ${pageNo} of ${view.numPages}`;
      prev.disabled = pageNo === 1; next.disabled = pageNo === view.numPages;
      const { canvas } = await drawPage(view, pageNo, { width: Math.min(900, Math.max(320, main.clientWidth)) * 1.5 });
      stage.querySelector("canvas")?.remove();
      stage.prepend(canvas);
      draw();
    }

    function changed() {
      const used = items.filter((it) => it.type !== "text" || it.text.trim());
      undo.disabled = !items.length;
      go.disabled = !used.length;
    }

    // ---- drawing the items for this page
    function draw() {
      stage.querySelectorAll(".mark").forEach((m) => m.remove());
      for (const it of items.filter((i) => i.page === pageNo - 1)) stage.append(markFor(it));
      changed();
    }

    function place(el, it) {
      el.style.left = it.x * 100 + "%";
      el.style.top = it.y * 100 + "%";
      if (it.type !== "text") { el.style.width = it.w * 100 + "%"; el.style.height = it.h * 100 + "%"; }
    }

    function markFor(it) {
      const el = h(`<div class="mark ${it.type}"><button type="button" class="x" aria-label="Remove">×</button></div>`);
      place(el, it);
      el.querySelector(".x").onclick = (e) => { e.stopPropagation(); items.splice(items.indexOf(it), 1); draw(); };
      if (it.type === "text") {
        const box = h(`<div class="words" contenteditable="true" spellcheck="true" aria-label="Your text"></div>`);
        box.innerText = it.text;
        const fit = () => { box.style.fontSize = it.size * pxPerPt() + "px"; box.style.color = css(it.colour); };
        fit();
        box.addEventListener("input", () => { it.text = box.innerText.replace(/\n$/, ""); changed(); });
        box.addEventListener("focus", () => { selected = it; sizeSel.value = it.size; colourSel.value = it.colour; });
        box.addEventListener("blur", () => { if (!it.text.trim()) { items.splice(items.indexOf(it), 1); draw(); } });
        box.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.prepend(h(`<span class="grip" aria-hidden="true" title="Drag to move">⠿</span>`));
        el.append(box);
        el.fit = fit;
        el.box = box;
        dragBy(el.querySelector(".grip"), el, it);
      } else {
        if (it.type === "check" || it.type === "cross") {
          el.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">${STROKES[it.type].map((s) =>
            `<polyline points="${s.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${css(it.colour)}" stroke-width=".12" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</svg>`);
        }
        dragBy(el, el, it);
      }
      return el;
    }

    // moving an item by dragging `handle`
    function dragBy(handle, el, it) {
      let start = null;
      handle.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".x")) return;
        e.stopPropagation();
        start = { x: e.clientX, y: e.clientY, ix: it.x, iy: it.y };
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", (e) => {
        if (!start) return;
        const r = stage.getBoundingClientRect();
        it.x = Math.min(0.98, Math.max(0, start.ix + (e.clientX - start.x) / r.width));
        it.y = Math.min(0.98, Math.max(0, start.iy + (e.clientY - start.y) / r.height));
        place(el, it);
      });
      handle.addEventListener("pointerup", () => { start = null; });
    }

    // ---- adding items
    const frac = (e) => { const r = stage.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    let dragStart = null, ghost = null;
    // text, ticks and crosses go in on a completed click (a press would lose the new text box's
    // focus to the click itself); highlight and white-out are dragged out
    stage.addEventListener("click", (e) => {
      if (e.target.closest(".mark") || !["text", "check", "cross"].includes(tool)) return;
      const [x, y] = frac(e);
      const size = Number(sizeSel.value), colour = colourSel.value;
      if (tool === "text") {
        const it = { page: pageNo - 1, type: "text", x, y: Math.max(0, y - (size * 0.6) / vp().height), text: "", size, colour };
        items.push(it);
        draw();
        [...stage.querySelectorAll(".mark.text")].at(-1).box.focus();
      } else {
        const w = (size * 1.4) / vp().width, hh = (size * 1.4) / vp().height;
        items.push({ page: pageNo - 1, type: tool, x: Math.max(0, x - w / 2), y: Math.max(0, y - hh / 2), w, h: hh, size, colour });
        draw();
      }
    });
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".mark") || (tool !== "highlight" && tool !== "whiteout")) return;
      dragStart = frac(e);
      ghost = h(`<div class="mark ${tool}" style="opacity: .7"></div>`);
      stage.append(ghost);
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!dragStart) return;
      const [x, y] = frac(e);
      place(ghost, { x: Math.min(x, dragStart[0]), y: Math.min(y, dragStart[1]), w: Math.abs(x - dragStart[0]), h: Math.abs(y - dragStart[1]) });
    });
    stage.addEventListener("pointerup", (e) => {
      if (!dragStart) return;
      const [x, y] = frac(e);
      const box = { x: Math.min(x, dragStart[0]), y: Math.min(y, dragStart[1]), w: Math.abs(x - dragStart[0]), h: Math.abs(y - dragStart[1]) };
      ghost.remove(); dragStart = null;
      if (box.w > 0.005 && box.h > 0.004) items.push({ page: pageNo - 1, type: tool, ...box });
      draw();
    });

    // size and colour apply to what you add next, and to the text you're typing in
    const restyle = () => {
      if (!selected || selected.type !== "text" || !items.includes(selected)) return;
      selected.size = Number(sizeSel.value); selected.colour = colourSel.value;
      stage.querySelectorAll(".mark.text").forEach((m) => m.fit?.());
    };
    sizeSel.addEventListener("change", restyle);
    colourSel.addEventListener("change", restyle);
    undo.onclick = () => { items.pop(); draw(); };
    addEventListener("resize", () => stage.querySelectorAll(".mark.text").forEach((m) => m.fit?.()));

    show();

    // ---- saving
    go.addEventListener("click", () => busy(go, out, "Saving...", async () => {
      const { StandardFonts, rgb, degrees, LineCapStyle } = await lib();
      const doc = await openForEdit(bytesIn);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      // Helvetica in a PDF covers Western European letters; anything else (emoji, other
      // scripts) can't be written with it, so it's left out and the person is told
      const ok = new Map();
      const writable = (ch) => { if (!ok.has(ch)) { try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } } return ok.get(ch); };
      let dropped = 0;
      const toWrite = items.filter((it) => it.type !== "text" || it.text.trim());

      for (const it of toWrite) {
        const page = doc.getPage(it.page), v = vps[it.page];
        if (it.type === "highlight" || it.type === "whiteout") {
          const r = uprightRect(v, it);
          page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.rotate),
            color: it.type === "highlight" ? rgb(1, 0.87, 0.2) : rgb(1, 1, 1), opacity: it.type === "highlight" ? 0.4 : 1 });
        } else if (it.type === "check" || it.type === "cross") {
          const [r, g, b] = COLOURS[it.colour];
          for (const stroke of STROKES[it.type]) {
            for (let k = 1; k < stroke.length; k++) {
              const a = uprightPoint(v, it.x + stroke[k - 1][0] * it.w, it.y + stroke[k - 1][1] * it.h);
              const z = uprightPoint(v, it.x + stroke[k][0] * it.w, it.y + stroke[k][1] * it.h);
              page.drawLine({ start: { x: a.x, y: a.y }, end: { x: z.x, y: z.y }, thickness: it.size * 0.17, color: rgb(r, g, b), lineCap: LineCapStyle.Round });
            }
          }
        } else {
          const [r, g, b] = COLOURS[it.colour];
          it.text.split("\n").forEach((raw, i) => {
            const line = [...raw].filter((ch) => writable(ch) || (dropped++, false)).join("");
            if (!line.trim()) return;
            const at = uprightPoint(v, it.x, it.y + (it.size * (BASELINE + i * LINE)) / v.height);
            page.drawText(line, { x: at.x, y: at.y, size: it.size, font, color: rgb(r, g, b), rotate: degrees(at.rotate) });
          });
        }
      }
      const data = await doc.save();

      // read it back: every line of typed text should now be in the file, on its page
      const check = await openForView(data);
      const texts = (await pageTexts(check)).map((t) => t.replace(/\s+/g, " "));
      await check.destroy();
      const missing = toWrite.filter((it) => it.type === "text").flatMap((it) => it.text.split("\n").map((l) => [it.page, [...l].filter(writable).join("").trim()]))
        .filter(([p, l]) => l && !texts[p].includes(l));
      if (missing.length) throw new Error(`"${missing[0][1]}" didn't make it into the file, so nothing was saved.`);

      download(data, renamed(file, "-edited", "pdf"));
      const pages = new Set(toWrite.map((it) => it.page)).size;
      status(out, `Done and checked: ${plural(toWrite.length, "addition")} on ${plural(pages, "page")}.` +
        (dropped ? ` ${plural(dropped, "character")} (like emoji) can't be written in a PDF's built-in font and ${dropped === 1 ? "was" : "were"} left out.` : ""), "good");
    }));
  } });
}
