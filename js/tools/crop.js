import { onePdf, h, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, drawPage, viewports } from "../pdf.js";

export const intro = "Trim the white margins from every page, or draw the part of the page to keep.";

// The box around everything that isn't white paper, as fractions of the drawn page, with a
// little room kept around it. Null for an empty page.
function inkBox(canvas, pad = 0.02) {
  const { width: w, height: hgt } = canvas;
  const { data } = canvas.getContext("2d").getImageData(0, 0, w, hgt);
  let x0 = w, y0 = hgt, x1 = -1, y1 = -1;
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const fx0 = Math.max(0, x0 / w - pad), fy0 = Math.max(0, y0 / hgt - pad), fx1 = Math.min(1, (x1 + 1) / w + pad), fy1 = Math.min(1, (y1 + 1) / hgt + pad);
  return { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 };
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Crop</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const vps = await viewports(view);
    let mode = "trim", pageNo = 1, drawn = null;      // drawn: the box to keep, as fractions of the page shown
    const trims = [];                                  // per page, from the ink

    desk.innerHTML = `<h2>Crop</h2>
      <label class="check"><input type="radio" name="mode" value="trim" checked> Trim white margins on every page</label>
      <label class="check"><input type="radio" name="mode" value="draw"> Draw the area to keep</label>
      <label class="check" data-for="draw" hidden><input type="checkbox" name="all" checked> Use the same area on every page</label>
      <p class="crop-line" style="font-size: 14px"></p>
      <button type="button" class="pill go" disabled>Crop PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">Cropping hides the edges rather than deleting them: they're still in the file and can be brought back in an editor. To remove something for good, use <a href="#/redact">Redact</a>.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".crop-line");

    const pager = h(`<div class="pager"><button type="button" class="icon-btn" aria-label="Previous page">${svg("left")}</button><span></span><button type="button" class="icon-btn" aria-label="Next page">${svg("right")}</button></div>`);
    const stage = h(`<div class="stage crop-stage"></div>`);
    main.append(pager, stage);
    const [prev, next] = pager.querySelectorAll("button");
    prev.onclick = () => { if (pageNo > 1) { pageNo--; show(); } };
    next.onclick = () => { if (pageNo < view.numPages) { pageNo++; show(); } };

    // margins come from a small drawing of each page, done once
    line.textContent = "Measuring the margins...";
    for (let n = 1; n <= view.numPages; n++) trims.push(inkBox((await drawPage(view, n, { width: 360 })).canvas));

    const boxFor = (i) => (mode === "trim" ? trims[i] : drawn && (desk.querySelector("[name=all]").checked || i === drawn.page) ? drawn : null);

    async function show() {
      pager.querySelector("span").textContent = `Page ${pageNo} of ${view.numPages}`;
      prev.disabled = pageNo === 1; next.disabled = pageNo === view.numPages;
      const { canvas } = await drawPage(view, pageNo, { width: Math.min(900, Math.max(320, main.clientWidth)) * 1.5 });
      stage.querySelector("canvas")?.remove();
      stage.prepend(canvas);
      outline();
    }
    function outline() {
      stage.querySelector(".keep")?.remove();
      const b = boxFor(pageNo - 1);
      if (b) {
        const el = h(`<div class="keep"></div>`);
        Object.assign(el.style, { left: b.x * 100 + "%", top: b.y * 100 + "%", width: b.w * 100 + "%", height: b.h * 100 + "%" });
        stage.append(el);
      }
      const n = vps.filter((_, i) => boxFor(i)).length;
      line.textContent = mode === "trim"
        ? (n ? `Margins trimmed on ${plural(n, "page")}${n < vps.length ? `; ${vps.length - n} blank ${vps.length - n === 1 ? "page is" : "pages are"} left as they are` : ""}.` : "No margins to trim.")
        : drawn ? `Keeping the outlined area on ${plural(n, "page")}.` : "Drag on the page to outline the part to keep.";
      go.disabled = !n;
    }

    // drawing the area to keep
    let start = null, ghost = null;
    const frac = (e) => { const r = stage.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    stage.addEventListener("pointerdown", (e) => {
      if (mode !== "draw") return;
      start = frac(e);
      ghost = h(`<div class="keep"></div>`);
      stage.querySelector(".keep")?.remove();
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
      if (b.w > 0.03 && b.h > 0.03) drawn = { ...b, page: pageNo - 1 };
      outline();
    });

    desk.addEventListener("change", (e) => {
      if (e.target.name === "mode") {
        mode = e.target.value;
        desk.querySelector("[data-for=draw]").hidden = mode !== "draw";
        stage.classList.toggle("drawing", mode === "draw");
      }
      outline();
    });
    show();

    go.addEventListener("click", () => busy(go, out, "Cropping...", async () => {
      const doc = await openForEdit(bytesIn);
      let cropped = 0;
      vps.forEach((vp, i) => {
        const b = boxFor(i);
        if (!b) return;
        // the outlined corners, as the page shows them, back in the page's own coordinates
        const [ax, ay] = vp.convertToPdfPoint(b.x * vp.width, b.y * vp.height);
        const [bx, by] = vp.convertToPdfPoint((b.x + b.w) * vp.width, (b.y + b.h) * vp.height);
        doc.getPage(i).setCropBox(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
        cropped++;
      });
      download(await doc.save(), renamed(file, "-cropped", "pdf"));
      status(out, `Done: cropped ${plural(cropped, "page")}.`, "good");
    }));
  } });
}
