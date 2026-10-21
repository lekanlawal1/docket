import { onePdf, h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForView, drawPage, rasterize, pageTexts, viewer } from "../pdf.js";

export const intro = "Draw boxes over anything private, or search for words to black out. The text under the boxes is removed, not just covered, and the result is checked before you get it.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Redact</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const boxes = {};                // page index -> [{ x, y, w, h }] as fractions of the page
    const searched = [];             // words the person asked to remove, checked again at the end
    let pageNo = 1;

    desk.innerHTML = `<h2>Redact</h2>
      <p>Drag on the page to draw a box. Or find words on every page:</p>
      <label class="field">Find and black out<input type="text" name="find" placeholder="e.g. a name, an account number"><span class="note">Separate several with commas.</span></label>
      <button type="button" class="pill ghost mark" style="width: 100%">Mark every match</button>
      <p class="count" style="font-size: 14px; margin-top: 14px"></p>
      <p class="honest">Pages with boxes are turned into images, so their text can't be copied out afterwards. Other pages stay as they are.</p>
      <button type="button" class="pill go" disabled>Redact and check</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), count = desk.querySelector(".count");

    const pager = h(`<div class="pager"><button type="button" class="icon-btn" aria-label="Previous page">${svg("left")}</button><span></span><button type="button" class="icon-btn" aria-label="Next page">${svg("right")}</button></div>`);
    const stage = h(`<div class="stage" style="cursor: crosshair"></div>`);
    main.append(pager, stage);
    const [prev, next] = pager.querySelectorAll("button");
    prev.onclick = () => { if (pageNo > 1) { pageNo--; show(); } };
    next.onclick = () => { if (pageNo < view.numPages) { pageNo++; show(); } };

    async function show() {
      pager.querySelector("span").textContent = `Page ${pageNo} of ${view.numPages}`;
      prev.disabled = pageNo === 1; next.disabled = pageNo === view.numPages;
      const { canvas } = await drawPage(view, pageNo, { width: Math.min(900, Math.max(320, main.clientWidth)) * 1.5 });
      stage.innerHTML = "";
      stage.append(canvas);
      drawBoxes();
    }

    function drawBoxes() {
      stage.querySelectorAll(".box").forEach((b) => b.remove());
      (boxes[pageNo - 1] || []).forEach((b, i) => {
        const el = h(`<div class="box" style="left:${b.x * 100}%; top:${b.y * 100}%; width:${b.w * 100}%; height:${b.h * 100}%"><button type="button" aria-label="Remove this box">×</button></div>`);
        el.querySelector("button").onclick = (e) => { e.stopPropagation(); boxes[pageNo - 1].splice(i, 1); drawBoxes(); };
        stage.append(el);
      });
      const total = Object.values(boxes).reduce((n, list) => n + list.length, 0);
      const pages = Object.values(boxes).filter((l) => l.length).length;
      count.textContent = total ? `${plural(total, "box", "boxes")} on ${plural(pages, "page")}.` : "No boxes yet.";
      go.disabled = !total;
    }

    // drawing a box by dragging
    let start = null, ghost = null;
    const frac = (e) => { const r = stage.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      start = frac(e);
      ghost = h(`<div class="box" style="opacity: .6"></div>`);
      stage.append(ghost);
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!start) return;
      const [x, y] = frac(e);
      Object.assign(ghost.style, { left: Math.min(x, start[0]) * 100 + "%", top: Math.min(y, start[1]) * 100 + "%", width: Math.abs(x - start[0]) * 100 + "%", height: Math.abs(y - start[1]) * 100 + "%" });
    });
    stage.addEventListener("pointerup", (e) => {
      if (!start) return;
      const [x, y] = frac(e);
      const b = { x: Math.min(x, start[0]), y: Math.min(y, start[1]), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]) };
      ghost.remove(); start = null;
      if (b.w > 0.005 && b.h > 0.004) (boxes[pageNo - 1] ||= []).push(b);
      drawBoxes();
    });

    // finding words: pdf.js knows where each run of text sits, so a match becomes a box
    desk.querySelector(".mark").onclick = async () => {
      const terms = desk.querySelector("[name=find]").value.split(",").map((t) => t.trim()).filter(Boolean);
      if (!terms.length) return status(out, "Type a word or phrase to find.", "bad");
      const { Util } = await viewer();
      // character counts are a poor guide in proportional fonts, so measure the text with a
      // font of the same family and take the match's share of the run's real width
      const ruler = document.createElement("canvas").getContext("2d");
      let hits = 0;
      for (let p = 1; p <= view.numPages; p++) {
        const page = await view.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const { items, styles } = await page.getTextContent();
        for (const item of items) {
          if (!item.str) continue;
          const lower = item.str.toLowerCase();
          ruler.font = `100px ${styles[item.fontName]?.fontFamily || "sans-serif"}`;
          const whole = ruler.measureText(item.str).width || 1;
          for (const term of terms) {
            let at = lower.indexOf(term.toLowerCase());
            while (at >= 0) {
              const m = Util.transform(vp.transform, item.transform);
              const size = Math.hypot(m[2], m[3]), width = item.width * vp.scale;
              const from = (width * ruler.measureText(item.str.slice(0, at)).width) / whole;
              const span = (width * ruler.measureText(item.str.slice(at, at + term.length)).width) / whole;
              // generous padding: a sliver of a letter left showing is still a leak
              const pad = size * 0.25;
              (boxes[p - 1] ||= []).push({ x: (m[4] + from - pad) / vp.width, y: (m[5] - size * 1.05) / vp.height, w: (span + pad * 2) / vp.width, h: (size * 1.4) / vp.height });
              hits++;
              at = lower.indexOf(term.toLowerCase(), at + term.length);
            }
          }
        }
      }
      searched.push(...terms);
      status(out, hits ? `Marked ${plural(hits, "match", "matches")}. Check each page, then redact.` : "No matches. Scanned pages have no text to search: draw boxes on those instead.", hits ? "" : "bad");
      drawBoxes();
    };

    show();

    go.addEventListener("click", () => busy(go, out, "Redacting...", async () => {
      const which = new Set(Object.keys(boxes).filter((k) => boxes[k].length).map(Number));
      const result = await rasterize(bytesIn, { which, boxes, scale: 2.5, quality: 0.9, onPage: (i, n) => status(out, `Page ${i} of ${n}...`) });

      // read the result back: redacted pages must have no text left, and searched words must be gone everywhere
      const check = await openForView(result);
      const texts = await pageTexts(check);
      await check.destroy();
      const leftovers = [...which].filter((i) => texts[i].trim());
      const still = searched.filter((t) => texts.some((x) => x.toLowerCase().includes(t.toLowerCase())));
      if (leftovers.length || still.length) {
        throw new Error(`the check failed (${still.length ? `"${still.join('", "')}" can still be found` : `text remains on page ${leftovers[0] + 1}`}), so nothing was saved.`);
      }
      download(result, renamed(file, "-redacted", "pdf"));
      status(out, `Done and checked: ${plural(which.size, "page")} redacted, no text left under the boxes${searched.length ? `, and ${searched.map((t) => `"${esc(t)}"`).join(", ")} appear${searched.length === 1 ? "s" : ""} nowhere in the file` : ""}.`, "good");
    }));
  } });
}
