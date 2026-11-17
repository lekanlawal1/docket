import { onePdf, h, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, drawPage, viewports, uprightRect, uprightPoint, lib } from "../pdf.js";

export const intro = "Draw or type your signature, then tap where it goes. Initials, your name, the date, text and checkmarks go on the same way, on as many pages as you need.";

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
  // resizing a canvas wipes it, so a size change (a tab switch, a phone turning) keeps what's drawn
  const fit = (keep = true) => {
    const r = pad.getBoundingClientRect();
    if (!r.width) return;
    const w = Math.round(r.width * 2), hgt = Math.round(r.height * 2);
    if (keep && pad.width === w && pad.height === hgt) return;
    const old = keep && dirty ? Object.assign(document.createElement("canvas"), { width: pad.width, height: pad.height }) : null;
    old?.getContext("2d").drawImage(pad, 0, 0);
    pad.width = w; pad.height = hgt;
    const ctx = pad.getContext("2d");
    if (old) ctx.drawImage(old, 0, 0, w, hgt);
    ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#13233A";
  };
  new ResizeObserver(() => fit()).observe(pad);
  const at = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2]; };
  pad.addEventListener("pointerdown", (e) => { fit(); drawing = true; last = at(e); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = at(e), ctx = pad.getContext("2d");
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p; dirty = true;
  });
  pad.addEventListener("pointerup", () => { drawing = false; if (dirty) onChange(); });
  return { el: pad, fit, clear: () => { dirty = false; fit(false); }, image: () => (dirty ? trimmed(pad) : null) };
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

// What a tap on the page can place. Signature and initials are pictures; name, date and text are
// real PDF text (sharp and searchable); a checkmark is two drawn lines, so it needs no font.
const KINDS = [["signature", "Signature"], ["initials", "Initials"], ["name", "Full name"], ["date", "Date"], ["text", "Text"], ["check", "Checkmark"]];
const TEXT_KINDS = new Set(["name", "date", "text"]);
const INK = "#14233B";
const initialsOf = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");
// Text height on the page as a fraction of the page's height, from the size slider (28 is about 12 pt on Letter).
const textH = (size) => size / 100 * 0.055;
// Initials match a signature's height rather than its width, since "JE" is nearly square.
const initialsH = (size) => size / 100 * 0.16;
const checkW = (size) => size / 100 * 0.12;

function textWidth(text, px) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${px}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}

// For text the built-in PDF font can't draw (Chinese, Arabic, ...), a sharp picture of it instead.
function textPicture(text) {
  const px = 96, c = Object.assign(document.createElement("canvas"), { width: Math.ceil(textWidth(text, px)) + 8, height: Math.ceil(px * 1.3) });
  const ctx = c.getContext("2d");
  ctx.font = `${px}px Helvetica, Arial, sans-serif`; ctx.fillStyle = INK; ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 4, px);
  return c;
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Your signature</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    let pageNo = 1, signature = null, initials = null, kind = "signature";
    const placed = [];          // { kind, page (0-based), x, y, w, h, value? } as fractions of the page
    const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    desk.innerHTML = `<h2>Your signature</h2>
      <div class="tools-row" role="tablist" style="margin-bottom: 10px">
        <button type="button" class="pill" data-tab="draw" role="tab" aria-selected="true">Draw</button>
        <button type="button" class="pill ghost" data-tab="type" role="tab" aria-selected="false">Type</button></div>
      <div data-panel="draw"><div class="pad-spot"></div>
        <button type="button" class="pill ghost clear" style="margin-top: 8px">Clear</button></div>
      <div data-panel="type" hidden>
        <label class="field">Signature as typed<input type="text" name="typed" placeholder="Your name"></label></div>
      <label class="field">Style for typed signature and initials<select name="font">
        <option value='"Brush Script MT", "Segoe Script", cursive'>Script</option>
        <option value='"Snell Roundhand", "Lucida Handwriting", cursive'>Flowing</option>
        <option value='Georgia, serif'>Plain</option></select></label>
      <h3 style="margin: 18px 0 6px; font-size: 15px">Tap the page to place</h3>
      <div class="tools-row" role="radiogroup" aria-label="What to place" style="flex-wrap: wrap; gap: 6px">
        ${KINDS.map(([k, label]) => `<button type="button" class="pill${k === "signature" ? "" : " ghost"}" data-kind="${k}" role="radio" aria-checked="${k === "signature"}">${label}</button>`).join("")}</div>
      <label class="field" style="margin-top: 12px">Full name<input type="text" name="fullname" autocomplete="name" placeholder="Jordan Example"></label>
      <label class="field">Initials<input type="text" name="initials" maxlength="6" placeholder="From your name"></label>
      <label class="field">Date<input type="text" name="date" value="${today}"></label>
      <label class="field">Text<input type="text" name="text" placeholder="Anything else the form asks for"></label>
      <label class="field" style="margin-top: 14px">Size on the page<input type="range" name="size" min="10" max="60" value="28"></label>
      <p class="hint-line" style="font-size: 14px"></p>
      <button type="button" class="pill go" disabled>Save signed PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">This places a picture of your signature, which is what most forms ask for. It isn't a certificate-based digital signature.</p>${privateNote()}`;
    const $ = (sel) => desk.querySelector(sel);
    const go = $(".go"), out = $(".status"), hint = $(".hint-line");
    const pad = signaturePad(refresh);
    $(".pad-spot").append(pad.el);
    requestAnimationFrame(pad.fit);
    $(".clear").onclick = () => { pad.clear(); refresh(); };
    let tab = "draw";
    desk.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      desk.querySelectorAll("[data-tab]").forEach((x) => { x.className = "pill" + (x === b ? "" : " ghost"); x.setAttribute("aria-selected", x === b); });
      desk.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
      if (tab === "draw") requestAnimationFrame(pad.fit);
      refresh();
    }));
    desk.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
      kind = b.dataset.kind;
      desk.querySelectorAll("[data-kind]").forEach((x) => { x.className = "pill" + (x === b ? "" : " ghost"); x.setAttribute("aria-checked", x === b); });
      refresh();
    }));
    // initials follow the full name until someone types their own
    $("[name=fullname]").addEventListener("input", () => {
      const ini = $("[name=initials]");
      if (!ini.dataset.own) ini.value = initialsOf($("[name=fullname]").value);
      refresh();
    });
    $("[name=initials]").addEventListener("input", (e) => { e.target.dataset.own = e.target.value ? "1" : ""; refresh(); });
    ["typed", "date", "text"].forEach((n) => $(`[name=${n}]`).addEventListener("input", refresh));
    $("[name=font]").addEventListener("change", refresh);
    $("[name=size]").addEventListener("input", () => {
      const last = placed.findLast((p) => p.page === pageNo - 1);
      if (!last) return;
      const s = $("[name=size]").value, r = stage.getBoundingClientRect();
      const nh = TEXT_KINDS.has(last.kind) ? textH(s) : last.kind === "initials" ? initialsH(s) : null;
      if (nh) { last.w *= nh / last.h; last.h = nh; }
      else { const aspect = last.h / last.w; last.w = last.kind === "check" ? checkW(s) : s / 100; last.h = last.w * aspect; }
      if (r.width) drawMarks();
    });

    const valueOf = (k) => (k === "name" ? $("[name=fullname]").value : $(`[name=${k}]`).value).trim();
    const picture = (c) => (c ? { url: c.toDataURL("image/png"), aspect: c.height / c.width } : null);
    const missing = (p) => (p.kind === "signature" && !signature) || (p.kind === "initials" && !initials);

    function refresh() {
      const typed = $("[name=typed]").value.trim(), font = $("[name=font]").value, ini = $("[name=initials]").value.trim();
      signature = picture(tab === "draw" ? pad.image() : typed ? typedSignature(typed, font) : null);
      initials = picture(ini ? typedSignature(ini, font) : null);
      drawMarks();
      const need = { signature: !signature && "Draw or type your signature first.", initials: !initials && "Fill in your initials first.",
        name: !valueOf("name") && "Fill in your full name first.", date: !valueOf("date") && "Fill in the date first.", text: !valueOf("text") && "Type the text first." }[kind];
      hint.textContent = need || (placed.length ? `Placed ${plural(placed.length, "item")}. Drag to move; tap × to remove.` : "Now tap the page where it should go.");
      go.disabled = !placed.length || placed.some(missing);
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
      if (e.target.closest(".sig")) return;
      const r = stage.getBoundingClientRect(), s = $("[name=size]").value, ratio = r.width / r.height;
      let w, hh, value;
      if (kind === "signature") {
        if (!signature) return;
        w = s / 100; hh = w * signature.aspect * ratio;
      } else if (kind === "initials") {
        if (!initials) return;
        hh = initialsH(s); w = hh / (initials.aspect * ratio);
      } else if (TEXT_KINDS.has(kind)) {
        value = valueOf(kind);
        if (!value) return;
        // a little spare width: the font on screen and the PDF's Helvetica differ slightly
        hh = textH(s); w = (textWidth(value, hh * r.height * 0.8) / r.width) * 1.08 + 0.006;
      } else { w = checkW(s); hh = w * ratio; }
      placed.push({ kind, page: pageNo - 1, x: (e.clientX - r.left) / r.width - w / 2, y: (e.clientY - r.top) / r.height - hh / 2, w, h: hh, value });
      refresh();
    });

    const TICK = `<svg viewBox="0 0 10 10" width="100%" height="100%" aria-hidden="true" style="display:block; pointer-events:none"><path d="M2 5.5 4.2 7.8 8.2 2.5" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    function drawMarks() {
      stage.querySelectorAll(".sig").forEach((s) => s.remove());
      const sh = stage.getBoundingClientRect().height;
      placed.forEach((p, idx) => {
        if (p.page !== pageNo - 1 || missing(p)) return;
        const body = p.kind === "signature" || p.kind === "initials"
          ? `<img src="${(p.kind === "signature" ? signature : initials).url}" alt="Your ${p.kind}">`
          : p.kind === "check" ? TICK
          : `<span style="display:block; font: ${p.h * sh * 0.8}px/1.25 Helvetica, Arial, sans-serif; color:${INK}; white-space:nowrap; pointer-events:none"></span>`;
        const el = h(`<div class="sig" style="left:${p.x * 100}%; top:${p.y * 100}%; width:${p.w * 100}%; height:${p.h * 100}%">
          ${body}<button type="button" aria-label="Remove this ${KINDS.find(([k]) => k === p.kind)[1].toLowerCase()}" style="position:absolute; top:-12px; right:-12px; width:26px; height:26px; border-radius:50%; border:0; background:#E66767; color:#fff; cursor:pointer">×</button></div>`);
        el.querySelector("span")?.append(p.value);
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
    refresh();
    showPage();

    go.addEventListener("click", () => busy(go, out, "Signing...", async () => {
      const { degrees, StandardFonts, rgb } = await lib();
      const doc = await openForEdit(bytesIn);
      const embed = async (pic) => doc.embedPng(await (await fetch(pic.url)).arrayBuffer());
      const pngs = {};
      if (placed.some((p) => p.kind === "signature")) pngs.signature = await embed(signature);
      if (placed.some((p) => p.kind === "initials")) pngs.initials = await embed(initials);
      const vps = await viewports(view);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const ink = rgb(0.08, 0.14, 0.23);
      for (const p of placed) {
        const page = doc.getPage(p.page), vp = vps[p.page];
        if (pngs[p.kind]) {
          const r = uprightRect(vp, p);
          page.drawImage(pngs[p.kind], { x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.rotate) });
        } else if (TEXT_KINDS.has(p.kind)) {
          const size = p.h * vp.height * 0.8, at = uprightPoint(vp, p.x, p.y + p.h * 0.82);
          try {
            page.drawText(p.value, { x: at.x, y: at.y, size, font, color: ink, rotate: degrees(at.rotate) });
          } catch {
            // the built-in font only covers Western scripts; anything else goes on as a picture of the text
            const img = await doc.embedPng(await (await fetch(textPicture(p.value).toDataURL("image/png"))).arrayBuffer());
            const r = uprightRect(vp, p);
            page.drawImage(img, { x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.rotate) });
          }
        } else {
          // the checkmark: two strokes through three points, placed upright like everything else
          const pt = (fx, fy) => uprightPoint(vp, p.x + p.w * fx, p.y + p.h * fy);
          const [a, b, c] = [pt(0.2, 0.55), pt(0.42, 0.78), pt(0.82, 0.25)];
          const thickness = Math.max(1, p.h * vp.height * 0.12);
          page.drawLine({ start: a, end: b, thickness, color: ink, lineCap: 1 });
          page.drawLine({ start: b, end: c, thickness, color: ink, lineCap: 1 });
        }
      }
      download(await doc.save(), renamed(file, "-signed", "pdf"));
      status(out, `Done: ${plural(placed.length, "item")} on ${plural(new Set(placed.map((p) => p.page)).size, "page")}.`, "good");
    }));
  } });
}
