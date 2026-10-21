import { h, esc, download, status } from "../ui.js";

export const intro = "A QR code for a link, a Wi-Fi network or your contact card. It never expires and doesn't route through anyone's tracking link.";

// qrcode-generator is loaded as a plain script in index.html and sets window.qrcode
const qr = () => {
  window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];
  return window.qrcode;
};

// Wi-Fi and contact codes have their own small formats; these characters need a backslash
const wifiEsc = (s) => s.replace(/([\\;,:"])/g, "\\$1");
const vcardEsc = (s) => s.replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");

export function payload(kind, v) {
  if (kind === "wifi") {
    if (!v.ssid) return "";
    return `WIFI:T:${v.security};S:${wifiEsc(v.ssid)};${v.security === "nopass" ? "" : `P:${wifiEsc(v.pass)};`}${v.hidden ? "H:true;" : ""};`;
  }
  if (kind === "contact") {
    if (!v.name) return "";
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vcardEsc(v.name)}`];
    if (v.org) lines.push(`ORG:${vcardEsc(v.org)}`);
    if (v.phone) lines.push(`TEL:${vcardEsc(v.phone)}`);
    if (v.email) lines.push(`EMAIL:${vcardEsc(v.email)}`);
    if (v.site) lines.push(`URL:${vcardEsc(v.site)}`);
    lines.push("END:VCARD");
    return lines.join("\n");
  }
  return v.text;
}

export function mount({ main, desk, privateNote }) {
  main.innerHTML = `
    <label class="check"><input type="radio" name="kind" value="text" checked> Link or text</label>
    <label class="check"><input type="radio" name="kind" value="wifi"> Wi-Fi</label>
    <label class="check"><input type="radio" name="kind" value="contact"> Contact card</label>
    <div data-for="text"><label class="field">Link or text<textarea name="text" rows="3" placeholder="https://..."></textarea></label></div>
    <div data-for="wifi" hidden>
      <label class="field">Network name<input type="text" name="ssid" autocomplete="off"></label>
      <label class="field">Password<input type="text" name="pass" autocomplete="off"></label>
      <label class="field">Security<select name="security"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">None</option></select></label>
      <label class="check"><input type="checkbox" name="hidden"> Hidden network</label>
    </div>
    <div data-for="contact" hidden>
      <label class="field">Name<input type="text" name="name"></label>
      <label class="field">Company<input type="text" name="org"></label>
      <label class="field">Phone<input type="text" name="phone" inputmode="tel"></label>
      <label class="field">Email<input type="text" name="email" inputmode="email"></label>
      <label class="field">Website<input type="text" name="site" inputmode="url"></label>
    </div>`;

  desk.innerHTML = `<h2>Your code</h2>
    <div class="qr-out"><p style="color: #555; margin: 0">Type something to see it.</p></div>
    <div style="display: flex; gap: 10px; margin-top: 14px">
      <label class="field" style="flex: 1">Colour<input type="color" name="fg" value="#1d2b3a"></label>
      <label class="field" style="flex: 1">Background<input type="color" name="bg" value="#ffffff"></label>
    </div>
    <label class="field">Survives damage<select name="level"><option value="L">A little</option><option value="M" selected>Some</option><option value="Q">More</option><option value="H">Most (for printing small)</option></select></label>
    <div style="display: flex; gap: 10px; flex-wrap: wrap">
      <button type="button" class="pill go png" disabled>Save PNG</button>
      <button type="button" class="pill ghost svg" disabled>Save SVG</button>
    </div>
    <p class="status" role="status"></p>${privateNote().replace("Your files stay", "What you type stays")}`;
  const box = desk.querySelector(".qr-out"), out = desk.querySelector(".status");
  const pngBtn = desk.querySelector(".png"), svgBtn = desk.querySelector(".svg");
  const val = (n) => { const el = main.querySelector(`[name=${n}]`) || desk.querySelector(`[name=${n}]`); return el.type === "checkbox" ? el.checked : el.value.trim(); };
  let code = null;

  function render() {
    const kind = main.querySelector("[name=kind]:checked").value;
    main.querySelectorAll("[data-for]").forEach((d) => (d.hidden = d.dataset.for !== kind));
    const text = payload(kind, Object.fromEntries(["text", "ssid", "pass", "security", "hidden", "name", "org", "phone", "email", "site"].map((n) => [n, val(n)])));
    status(out, "");
    code = null;
    pngBtn.disabled = svgBtn.disabled = true;
    if (!text) { box.innerHTML = `<p style="color: #555; margin: 0">Type something to see it.</p>`; return; }
    try {
      code = qr()(0, val("level"));
      code.addData(text, "Byte");
      code.make();
    } catch {
      code = null;
      box.innerHTML = "";
      status(out, "That's too much text for one QR code. Shorten it, or lower \"Survives damage\".", "bad");
      return;
    }
    box.innerHTML = "";
    box.style.background = val("bg");
    box.append(canvas(12));
    pngBtn.disabled = svgBtn.disabled = false;
    if (kind === "text" && /^https?:\/\//i.test(text)) status(out, "Scan it with your phone before you print it.", "");
  }

  // drawn by hand rather than with the library's helpers, so the colours can be chosen
  function canvas(cell) {
    const n = code.getModuleCount(), quiet = 4;
    const c = Object.assign(document.createElement("canvas"), { width: (n + quiet * 2) * cell, height: (n + quiet * 2) * cell });
    const ctx = c.getContext("2d");
    ctx.fillStyle = val("bg");
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = val("fg");
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (code.isDark(r, col)) ctx.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", "QR code");
    return c;
  }

  function svgText() {
    const n = code.getModuleCount(), quiet = 4, size = n + quiet * 2;
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${esc(val("bg"))}"/><path d="${path}" fill="${esc(val("fg"))}"/></svg>\n`;
  }

  // a light code on a dark background is the one combination many phone cameras can't read
  const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };

  pngBtn.onclick = () => canvas(20).toBlob((b) => download(b, "qr-code.png"), "image/png");
  svgBtn.onclick = () => download(svgText(), "qr-code.svg", "image/svg+xml");
  for (const root of [main, desk]) root.addEventListener("input", () => {
    render();
    if (code && luminance(val("fg")) > luminance(val("bg")) - 60) status(out, "The colours are too close or reversed; some phones won't scan it. Dark on light works best.", "bad");
  });
  main.addEventListener("change", render);
  render();
}
