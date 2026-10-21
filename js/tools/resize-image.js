import { download, renamed, bytes, busy, status } from "../ui.js";
import { oneImage, drawn, toBlob, needsBackground, preview, FORMATS } from "../images.js";

export const intro = "Make a picture smaller or a set size: for a profile photo, a banner, or a site with an upload limit.";

const PRESETS = {
  square: { label: "Square post (1080 × 1080)", w: 1080, h: 1080 },
  profile: { label: "Profile photo (400 × 400)", w: 400, h: 400 },
  linkedin: { label: "LinkedIn banner (1584 × 396)", w: 1584, h: 396 },
  hd: { label: "Widescreen (1920 × 1080)", w: 1920, h: 1080 },
  story: { label: "Story (1080 × 1920)", w: 1080, h: 1920 },
};

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>New size</h2><p>Load a picture to begin.</p>`;

  oneImage(main, { files, onLoad: (file, bitmap) => {
    const W = bitmap.width, H = bitmap.height;
    const sameType = FORMATS[file.type] ? file.type : "image/jpeg";
    desk.innerHTML = `<h2>New size</h2>
      <label class="check"><input type="radio" name="mode" value="percent" checked> By percentage</label>
      <label class="check"><input type="radio" name="mode" value="exact"> Exact size</label>
      <label class="check"><input type="radio" name="mode" value="preset"> Common sizes</label>
      <div data-for="percent"><label class="field">Scale <span class="note pct-note"></span><input type="range" name="pct" min="5" max="100" value="50"></label></div>
      <div data-for="exact" hidden>
        <div style="display: flex; gap: 10px">
          <label class="field" style="flex: 1">Width<input type="number" name="w" min="1" max="10000" value="${W}"></label>
          <label class="field" style="flex: 1">Height<input type="number" name="h" min="1" max="10000" value="${H}"></label>
        </div>
        <label class="check"><input type="checkbox" name="keep" checked> Keep the shape</label>
      </div>
      <div data-for="preset" hidden>
        <label class="field">Size<select name="preset">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join("")}</select>
        <span class="note">Fills the frame and trims the edges evenly.</span></label>
      </div>
      <label class="field">Save as<select name="type">
        <option value="${sameType}">Same as now (${FORMATS[sameType].toUpperCase()})</option>
        ${Object.entries(FORMATS).filter(([t]) => t !== sameType).map(([t, ext]) => `<option value="${t}">${ext.toUpperCase()}</option>`).join("")}
      </select></label>
      <p class="size-line" style="font-size: 14px"></p>
      <button type="button" class="pill go">Resize</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const q = (n) => desk.querySelector(`[name=${n}]`);
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), line = desk.querySelector(".size-line");

    // the size the current settings ask for: [width, height, crop?]
    function target() {
      const mode = desk.querySelector("[name=mode]:checked").value;
      if (mode === "percent") { const p = +q("pct").value / 100; return [Math.max(1, Math.round(W * p)), Math.max(1, Math.round(H * p)), false]; }
      if (mode === "preset") { const p = PRESETS[q("preset").value]; return [p.w, p.h, true]; }
      return [Math.max(1, +q("w").value || 1), Math.max(1, +q("h").value || 1), false];
    }

    function refresh(e) {
      const mode = desk.querySelector("[name=mode]:checked").value;
      desk.querySelectorAll("[data-for]").forEach((d) => (d.hidden = d.dataset.for !== mode));
      if (q("keep").checked && e?.target === q("w")) q("h").value = Math.max(1, Math.round((+q("w").value * H) / W));
      if (q("keep").checked && e?.target === q("h")) q("w").value = Math.max(1, Math.round((+q("h").value * W) / H));
      desk.querySelector(".pct-note").textContent = `${q("pct").value}%`;
      const [w, hgt] = target();
      line.textContent = `${W} × ${H} → ${w} × ${hgt}` + (w > W || hgt > H ? ". Bigger than the original, so it may look soft." : "");
    }
    desk.addEventListener("input", refresh);
    desk.addEventListener("change", refresh);
    refresh();

    go.addEventListener("click", () => busy(go, out, "Resizing...", async () => {
      const [w, hgt, crop] = target();
      const type = q("type").value;
      const canvas = drawn(bitmap, w, hgt, { crop, background: needsBackground(type) ? "#fff" : null });
      const blob = await toBlob(canvas, type, 0.9);
      main.querySelector("figure")?.remove();
      main.append(preview(blob));
      download(blob, renamed(file, `-${w}x${hgt}`, FORMATS[type]));
      status(out, `Done: ${w} × ${hgt}, ${bytes(blob.size)}.`, "good");
    }));
  } });
}
