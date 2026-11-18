import { onePdf, h, download, renamed, plural, busy, status } from "../ui.js";
import { svg } from "../icons.js";
import { readBytes, openForEdit, openForView, drawPage, viewports, uprightRect, uprightPoint, lib } from "../pdf.js";
import { sha256, grouped, CERT_TITLE, ORIGINAL_LABEL } from "../fingerprint.js";

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

// A last page that records what happened: the document, who signed and when, what went where,
// and the fingerprint of the document as it was before anyone signed. Verify reads it back.
async function addCertificate(doc, { StandardFonts, rgb }, info) {
  const first = doc.getPage(0).getSize();
  const [W, H] = first.width <= first.height ? [first.width, first.height] : [612, 792];
  const page = doc.addPage([W, H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.08, 0.14, 0.23), grey = rgb(0.38, 0.4, 0.44), M = 64, maxW = W - M * 2;
  let y = H - M - 10;
  // the built-in fonts only cover Western scripts; anything else is written as a picture of the text
  const put = async (text, x, font, size, color = ink) => {
    try { page.drawText(text, { x, y, size, font, color }); return font.widthOfTextAtSize(text, size); }
    catch {
      const c = textPicture(text), img = await doc.embedPng(await (await fetch(c.toDataURL("image/png"))).arrayBuffer());
      const h = size * 1.25, w = h * c.width / c.height;
      page.drawImage(img, { x, y: y - size * 0.25, width: w, height: h });
      return w;
    }
  };
  const wrap = async (text, font, size, color, gap = 1.45) => {
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(next, size) > maxW) { await put(line, M, font, size, color); y -= size * gap; line = word; } else line = next;
    }
    if (line) { await put(line, M, font, size, color); y -= size * gap; }
  };
  const field = async (label, value) => {
    const w = await put(label + ":", M, bold, 11);
    await put(value, M + w + 5, regular, 11);
    y -= 20;
  };
  await put(CERT_TITLE, M, bold, 22); y -= 22;
  await wrap("Made by Docket in the signer's own browser. Nothing was uploaded.", regular, 10, grey); y -= 14;
  await field("Document", info.document);
  await field("Pages", `${info.pages}, not counting this certificate`);
  await field("Signed by", info.signer || "Not given");
  await field("Signed on", info.local);
  await field("Signed on (UTC)", info.utc);
  // the same bold label as the other rows; the list wraps under itself if it's long
  const lw = await put("Placed:", M, bold, 11);
  const words = info.placed.split(" ");
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (line && regular.widthOfTextAtSize(next, 11) > maxW - lw - 5) { await put(line, M + lw + 5, regular, 11); y -= 16; line = word; } else line = next;
  }
  if (line) await put(line, M + lw + 5, regular, 11);
  y -= 30;
  await put(`${ORIGINAL_LABEL} (SHA-256):`, M, bold, 11); y -= 18;
  await put(grouped(info.original), M, mono, 10); y -= 34;
  await put("How to check this", M, bold, 12); y -= 18;
  await wrap("Docket's Verify tool reads this page back. Give it the original document and it says whether that is the exact document that was signed. When this copy was saved, Docket also showed the signed copy's own fingerprint: keep it with your records, and Verify can later confirm the signed copy hasn't changed.", regular, 10.5, ink);
  y -= 14;
  await put("What this is", M, bold, 12); y -= 18;
  await wrap("A record of what happened in the signer's browser. It isn't a certificate-based digital signature, and no outside authority has checked it.", regular, 10.5, ink);
}

// "Signature on pages 1 and 3; Date on page 1"
function placedSummary(placed) {
  const pages = new Map();
  for (const p of placed) { const k = KINDS.find(([id]) => id === p.kind)[1]; pages.set(k, new Set([...(pages.get(k) || []), p.page + 1])); }
  const list = (ns) => { const a = [...ns].sort((x, y) => x - y); return a.length === 1 ? `page ${a[0]}` : `pages ${a.slice(0, -1).join(", ")} and ${a.at(-1)}`; };
  return [...pages].map(([k, ns]) => `${k} on ${list(ns)}`).join("; ");
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Your signature</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const original = await sha256(bytesIn);    // before anything else touches the bytes
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
      <label class="check"><input type="checkbox" name="certificate" checked> Add a signing certificate page</label>
      <p style="font-size: 13px; margin: 2px 0 12px; color: var(--muted, inherit)">A last page recording who signed, when, what went where, and the original document's fingerprint.</p>
      <p class="hint-line" style="font-size: 14px"></p>
      <button type="button" class="pill go" disabled>Save signed PDF</button>
      <p class="status" role="status"></p>
      <div class="signed-fp" hidden></div>
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
      const now = new Date();
      if ($("[name=certificate]").checked) await addCertificate(doc, await lib(), {
        document: file.name, pages: view.numPages, signer: valueOf("name"), placed: placedSummary(placed), original,
        local: now.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) + ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
        utc: now.toISOString().replace(/\.\d+Z$/, "Z")
      });
      const saved = await doc.save(), name = renamed(file, "-signed", "pdf");
      download(saved, name);
      status(out, `Done: ${plural(placed.length, "item")} on ${plural(new Set(placed.map((p) => p.page)).size, "page")}.`, "good");
      // the signed copy's own fingerprint: it can't go inside the file it describes, so it's shown here to keep
      const fp = await sha256(saved), box = $(".signed-fp");
      box.hidden = false;
      box.innerHTML = `<p style="margin: 14px 0 4px; font-weight: 600">Fingerprint of the signed file</p>
        <code class="fp-code">${grouped(fp)}</code>
        <div class="tools-row" style="margin-top: 8px; gap: 8px"><button type="button" class="pill ghost" data-copy>Copy</button><button type="button" class="pill ghost" data-save>Save as text</button></div>
        <p style="font-size: 13px; margin-top: 8px">Keep it with your records. Docket's Verify tool can use it later to confirm this exact file hasn't changed.</p>`;
      box.querySelector("[data-copy]").onclick = async (e) => { await navigator.clipboard?.writeText(fp).catch(() => {}); e.target.textContent = "Copied"; };
      box.querySelector("[data-save]").onclick = () => download(new Blob([
        `Signed copy: ${name}\nFingerprint (SHA-256): ${fp}\nSaved: ${now.toISOString()}\n` +
        `Check it with Docket's Verify tool: ${location.origin}${location.pathname}#/verify\n`], { type: "text/plain" }), renamed(file, "-signed-fingerprint", "txt"), "text/plain");
    }));
  } });
}
