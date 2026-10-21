import { onePdf, h, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, drawPage, viewports, uprightRect, uprightPoint, lib } from "../pdf.js";

export const intro = "Draw or type your signature, then tap where it goes. You can place it on as many pages as you need.";

// The pad and the typed version both end up as a PNG with the blank edges trimmed off.
function trimmed(canvas) {
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 10) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
  }
  if (right < 0) return null;
  const pad = 6, w = right - left + 1 + pad * 2, hgt = bottom - top + 1 + pad * 2;
  const out = Object.assign(document.createElement("canvas"), { width: w, height: hgt });
  out.getContext("2d").drawImage(canvas, left - pad, top - pad, w, hgt, 0, 0, w, hgt);
  return out;
}

function signaturePad(onChange) {
  const pad = h(`<canvas class="pad" aria-label="Draw your signature here"></canvas>`);
  let drawing = false, last = null, dirty = false;
  const fit = () => {
    const r = pad.getBoundingClientRect();
    if (!r.width) return;
    pad.width = r.width * 2; pad.height = r.height * 2;
    const ctx = pad.getContext("2d");
    ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#13233A";
  };
  const at = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]; };
  pad.addEventListener("pointerdown", (e) => { if (!pad.width) fit(); drawing = true; last = at(e); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = at(e), ctx = pad.getContext("2d");
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p; dirty = true;
  });
  pad.addEventListener("pointerup", () => { drawing = false; if (dirty) onChange(); });
  return { el: pad, fit, clear: () => { fit(); dirty = false; }, image: () => (dirty ? trimmed(pad) : null) };
}

function typedSignature(text, font) {
  const c = Object.assign(document.createElement("canvas"), { width: 1400, height: 300 });
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#13233A";
  ctx.font = `120px ${font}`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, 150);
  return trimmed(c);
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Your signature</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    let pageNo = 1, signature = null;
    const placed = [];          // { page (0-based), x, y, w, h } as fractions of the page

    desk.innerHTML = `<h2>Your signature</h2>
      <div class="tools-row" role="tablist" style="margin-bottom: 10px">
        <button type="button" class="pill" data-tab="draw" role="tab" aria-selected="true">Draw</button>
        <button type="button" class="pill ghost" data-tab="type" role="tab" aria-selected="false">Type</button></div>
      <div data-panel="draw"><div class="pad-spot"></div>
        <button type="button" class="pill ghost clear" style="margin-top: 8px">Clear</button></div>
      <div data-panel="type" hidden>
        <label class="field">Your name<input type="text" name="typed" placeholder="Your name"></label>
        <label class="field">Style<select name="font">
          <option value='"Brush Script MT", "Segoe Script", cursive'>Script</option>
          <option value='"Snell Roundhand", "Lucida Handwriting", cursive'>Flowing</option>
          <option value='Georgia, serif'>Plain</option></select></label></div>
      <label class="field" style="margin-top: 14px">Size on the page<input type="range" name="size" min="10" max="60" value="28"></label>
      <label class="check"><input type="checkbox" name="date"> Add today's date under it</label>
      <p class="hint-line" style="font-size: 14px">Draw or type your signature, then tap the page.</p>
      <button type="button" class="pill go" disabled>Save signed PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">This places a picture of your signature, which is what most forms ask for. It isn't a certificate-based digital signature.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), hint = desk.querySelector(".hint-line");
    const pad = signaturePad(refresh);
    desk.querySelector(".pad-spot").append(pad.el);
    requestAnimationFrame(pad.fit);
    desk.querySelector(".clear").onclick = () => { pad.clear(); refresh(); };
    let tab = "draw";
    desk.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      desk.querySelectorAll("[data-tab]").forEach((x) => { x.className = "pill" + (x === b ? "" : " ghost"); x.setAttribute("aria-selected", x === b); });
      desk.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
      if (tab === "draw") requestAnimationFrame(pad.fit);
      refresh();
    }));
    desk.querySelector("[name=typed]").addEventListener("input", refresh);
    desk.querySelector("[name=font]").addEventListener("change", refresh);
    desk.querySelector("[name=size]").addEventListener("input", () => {
      const last = placed.findLast((p) => p.page === pageNo - 1);
      if (last && signature) { const aspect = last.h / last.w; last.w = desk.querySelector("[name=size]").value / 100; last.h = last.w * aspect; drawMarks(); }
    });

    function refresh() {
      const name = desk.querySelector("[name=typed]").value.trim();
      const c = tab === "draw" ? pad.image() : name ? typedSignature(name, desk.querySelector("[name=font]").value) : null;
      signature = c ? { url: c.toDataURL("image/png"), aspect: c.height / c.width } : null;
      drawMarks();
      hint.textContent = !signature ? "Draw or type your signature, then tap the page." : placed.length ? `Placed ${plural(placed.length, "time")}. Drag to move; tap × to remove.` : "Now tap the page where it should go.";
      go.disabled = !signature || !placed.length;
    }

    const pager = h(`<div class="pager"><button type="button" class="icon-btn" aria-label="Previous page">${svg("left")}</button><span></span><button type="button" class="icon-btn" aria-label="Next page">${svg("right")}</button></div>`);
    const stage = h(`<div class="stage"></div>`);
    main.append(pager, stage);
    const [prev, next] = pager.querySelectorAll("button");
    prev.onclick = () => { if (pageNo > 1) { pageNo--; showPage(); } };
    next.onclick = () => { if (pageNo < view.numPages) { pageNo++; showPage(); } };

    async function showPage() {
      pager.querySelector("span").textContent = `Page ${pageNo} of ${view.numPages}`;
      prev.disabled = pageNo === 1; next.disabled = pageNo === view.numPages;
      const { canvas } = await drawPage(view, pageNo, { width: Math.min(900, Math.max(320, main.clientWidth)) * 1.5 });
      stage.innerHTML = "";
      stage.append(canvas);
      drawMarks();
    }

    stage.addEventListener("click", (e) => {
      if (!signature || e.target.closest(".sig")) return;
      const r = stage.getBoundingClientRect();
      const w = desk.querySelector("[name=size]").value / 100;
      const hh = w * signature.aspect * (r.width / r.height);
      placed.push({ page: pageNo - 1, x: (e.clientX - r.left) / r.width - w / 2, y: (e.clientY - r.top) / r.height - hh / 2, w, h: hh });
      refresh();
    });

    function drawMarks() {
      stage.querySelectorAll(".sig").forEach((s) => s.remove());
      if (!signature) return;
      placed.forEach((p, idx) => {
        if (p.page !== pageNo - 1) return;
        const el = h(`<div class="sig" style="left:${p.x * 100}%; top:${p.y * 100}%; width:${p.w * 100}%; height:${p.h * 100}%">
          <img src="${signature.url}" alt="Your signature"><button type="button" aria-label="Remove this signature" style="position:absolute; top:-12px; right:-12px; width:26px; height:26px; border-radius:50%; border:0; background:#E66767; color:#fff; cursor:pointer">×</button></div>`);
        el.querySelector("button").onclick = (e) => { e.stopPropagation(); placed.splice(idx, 1); refresh(); };
        let start = null;
        el.addEventListener("pointerdown", (e) => { if (e.target.tagName === "BUTTON") return; start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }; el.setPointerCapture(e.pointerId); });
        el.addEventListener("pointermove", (e) => {
          if (!start) return;
          const r = stage.getBoundingClientRect();
          p.x = Math.min(1 - p.w, Math.max(0, start.px + (e.clientX - start.x) / r.width));
          p.y = Math.min(1 - p.h, Math.max(0, start.py + (e.clientY - start.y) / r.height));
          el.style.left = p.x * 100 + "%"; el.style.top = p.y * 100 + "%";
        });
        el.addEventListener("pointerup", () => { start = null; });
        stage.append(el);
      });
    }
    showPage();

    go.addEventListener("click", () => busy(go, out, "Signing...", async () => {
      const { degrees, StandardFonts, rgb } = await lib();
      const doc = await openForEdit(bytesIn);
      const png = await doc.embedPng(await (await fetch(signature.url)).arrayBuffer());
      const vps = await viewports(view);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      for (const p of placed) {
        const page = doc.getPage(p.page), vp = vps[p.page];
        const r = uprightRect(vp, p);
        page.drawImage(png, { x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.rotate) });
        if (desk.querySelector("[name=date]").checked) {
          const at = uprightPoint(vp, p.x, p.y + p.h + 0.02);
          page.drawText(today, { x: at.x, y: at.y, size: 10, font, color: rgb(0.08, 0.14, 0.23), rotate: degrees(at.rotate) });
        }
      }
      download(await doc.save(), renamed(file, "-signed", "pdf"));
      status(out, `Done: signed on ${plural(new Set(placed.map((p) => p.page)).size, "page")}.`, "good");
    }));
  } });
}
