import { download, renamed, bytes, busy, status } from "../ui.js";
import { oneImage, drawn, toBlob, preview } from "../images.js";

export const intro = "Get a photo under a size limit, like the 200 KB some application forms ask for, while keeping it as sharp as the limit allows.";

// Finds the best JPG quality that fits under `limit` bytes at this size, or null if even
// the lowest sensible quality is too big. Quality vs size is monotonic, so halve the range.
async function fit(canvas, limit) {
  let lo = 0.3, hi = 0.95, best = null;
  const top = await toBlob(canvas, "image/jpeg", hi);
  if (top.size <= limit) return { blob: top, quality: hi };
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const blob = await toBlob(canvas, "image/jpeg", mid);
    if (blob.size <= limit) { best = { blob, quality: mid }; lo = mid; } else hi = mid;
  }
  if (!best) {
    const blob = await toBlob(canvas, "image/jpeg", lo);
    if (blob.size <= limit) best = { blob, quality: lo };
  }
  return best;
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Target</h2><p>Load a picture to begin.</p>`;

  oneImage(main, { files, onLoad: (file, bitmap) => {
    desk.innerHTML = `<h2>Target</h2><p>Now ${bytes(file.size)}.</p>
      <label class="field">Under this size<select name="limit">
        <option value="100">100 KB</option><option value="200" selected>200 KB</option><option value="500">500 KB</option>
        <option value="1024">1 MB</option><option value="2048">2 MB</option><option value="custom">Other...</option>
      </select></label>
      <label class="field" hidden data-custom>Size in KB<input type="number" name="kb" min="10" value="300"></label>
      <p class="honest">Saves as JPG. If lowering the quality isn't enough, the picture is made smaller too, and you'll be told.</p>
      <button type="button" class="pill go">Compress</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const custom = desk.querySelector("[data-custom]");
    desk.querySelector("[name=limit]").addEventListener("change", (e) => (custom.hidden = e.target.value !== "custom"));

    go.addEventListener("click", () => busy(go, out, "Compressing...", async () => {
      const pick = desk.querySelector("[name=limit]").value;
      const kb = pick === "custom" ? +desk.querySelector("[name=kb]").value : +pick;
      if (!(kb >= 10)) throw new Error("pick a size of at least 10 KB.");
      const limit = kb * 1024;

      // try full size first, then step down 15% at a time until it fits
      let scale = 1, result = null;
      while (!result && scale > 0.05) {
        const w = Math.max(1, Math.round(bitmap.width * scale)), hgt = Math.max(1, Math.round(bitmap.height * scale));
        result = await fit(drawn(bitmap, w, hgt, { background: "#fff" }), limit);
        if (result) result.size = [w, hgt];
        else scale *= 0.85;
      }
      if (!result) throw new Error(`couldn't get this picture under ${kb} KB.`);

      main.querySelector("figure")?.remove();
      main.append(preview(result.blob));
      download(result.blob, renamed(file, "-compressed", "jpg"));
      const [w, hgt] = result.size;
      const resized = w !== bitmap.width ? ` To fit, it was made smaller: ${bitmap.width} × ${bitmap.height} → ${w} × ${hgt}.` : "";
      status(out, `Done: ${bytes(file.size)} → ${bytes(result.blob.size)}.${resized}`, "good");
    }));
  } });
}
