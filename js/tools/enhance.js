import { h, download, renamed, bytes, busy, status } from "../ui.js";
import { oneImage, drawn, toBlob } from "../images.js";
import { loadWeights, GPUUpscaler, upscaleImage } from "../upscale.js";

export const intro = "Make a small or soft picture bigger and sharper: an old phone photo, a thumbnail, a picture that was squeezed by a chat app. Runs on this device.";

// Browsers (Safari especially) can't hold a picture much bigger than this
const MAX_PIXELS = 16_000_000;

let gpu = null;   // kept for the visit: setting it up is the slow part

// Classic sharpening: enlarge smoothly, then push each pixel away from its blurred
// surroundings ("unsharp mask"). Adds no detail that wasn't there; just makes edges crisper.
function sharpen(bitmap, factor) {
  const canvas = drawn(bitmap, bitmap.width * factor, bitmap.height * factor);
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width: w, height: hgt } = img;
  const r = Math.max(1, Math.round(factor * 0.8)), amount = 0.9;
  const blur = boxBlur(boxBlur(data, w, hgt, r), w, hgt, r);
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) {
    const d = data[i + c] - blur[i + c];
    if (Math.abs(d) > 2) data[i + c] = data[i + c] + amount * d;   // small differences are noise: leave them
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function boxBlur(src, w, hgt, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (const [from, to, horizontal] of [[src, tmp, true], [tmp, out, false]]) {
    for (let a = 0; a < (horizontal ? hgt : w); a++) for (let c = 0; c < 3; c++) {
      const len = horizontal ? w : hgt, at = (k) => (horizontal ? (a * w + k) : (k * w + a)) * 4 + c;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += from[at(Math.min(len - 1, Math.max(0, k)))];
      for (let k = 0; k < len; k++) {
        to[at(k)] = sum / (2 * r + 1);
        sum += from[at(Math.min(len - 1, k + r + 1))] - from[at(Math.max(0, k - r))];
      }
    }
  }
  return out;
}

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Enhance</h2><p>Load a picture to begin.</p>`;

  oneImage(main, { files, onLoad: (file, bitmap) => {
    const W = bitmap.width, H = bitmap.height;
    const fits = (f) => W * H * f * f <= MAX_PIXELS;
    desk.innerHTML = `<h2>Enhance</h2>
      <label class="check"><input type="radio" name="mode" value="ai" checked> AI upscale <span class="note">(sharpest; guesses at fine detail)</span></label>
      <label class="check"><input type="radio" name="mode" value="sharpen"> Sharpen only <span class="note">(no AI, instant)</span></label>
      <label class="field">Make it<select name="factor">
        <option value="2" ${fits(2) ? "" : "disabled"}>2× bigger (${W * 2} × ${H * 2})</option>
        <option value="4" ${fits(4) ? "" : "disabled"}>4× bigger (${W * 4} × ${H * 4})</option></select>
        ${fits(2) ? "" : `<span class="note">This picture is already big (${W} × ${H}); twice the size is more than a browser can save. Try Resize image to make it smaller first, or use it as it is.</span>`}</label>
      <label class="field">Save as<select name="type"><option value="image/jpeg">JPG (smaller file)</option><option value="image/png">PNG (exact)</option></select></label>
      <button type="button" class="pill go" ${fits(2) ? "" : "disabled"}>Enhance</button>
      <button type="button" class="pill ghost save" hidden>Save picture</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">The AI makes its best guess at detail that isn't in the picture. It's great for photos, but it can reshape small text, numbers and faces, so don't use it for receipts, IDs, documents or anything used as evidence. To make a photo of a page readable, use <a href="#/scan">Scan</a> instead. The first time, the AI model downloads (2.4 MB).</p>${privateNote()}`;
    const go = desk.querySelector(".go"), save = desk.querySelector(".save"), out = desk.querySelector(".status");
    const val = (n) => desk.querySelector(`[name=${n}]:checked`)?.value ?? desk.querySelector(`[name=${n}]`).value;
    // small pictures, the usual case, go to 4×; bigger ones to 2× so the file stays manageable
    desk.querySelector("[name=factor]").value = fits(4) ? "4" : "2";
    let result = null;
    desk.addEventListener("change", () => { save.hidden = true; });

    const viewer = h(`<div class="compare-view" hidden>
      <div class="cv-frame"><div class="cv-pics"><canvas class="cv-before"></canvas><canvas class="cv-after"></canvas><div class="cv-line"></div></div></div>
      <label class="cv-slider"><span>Before</span><input type="range" min="0" max="100" value="50" aria-label="Before and after"><span>After</span></label>
      <p class="note">Shown at full size: scroll around to look closely.</p></div>`);
    main.append(viewer);
    const slider = viewer.querySelector("input"), pics = viewer.querySelector(".cv-pics");
    const split = () => pics.style.setProperty("--split", slider.value + "%");
    slider.addEventListener("input", split);
    split();

    go.addEventListener("click", () => busy(go, out, "Enhancing...", async () => {
      const factor = Number(val("factor")), mode = val("mode");
      save.hidden = true;
      const t0 = performance.now();
      let canvas;
      if (mode === "sharpen") {
        canvas = sharpen(bitmap, factor);
      } else {
        status(out, "Getting the AI model ready...");
        const layers = await loadWeights();
        gpu ??= GPUUpscaler.create(layers);
        if (!gpu) throw new Error("this browser or device can't run the AI upscaler (it needs WebGL2 graphics). Choose Sharpen only instead.");
        const src = drawn(bitmap, W, H).getContext("2d").getImageData(0, 0, W, H);
        const big = await upscaleImage(src, (p, w, hgt) => gpu.run(p, w, hgt), {
          onTile: (done, of) => { status(out, `Enhancing: ${Math.round((done / of) * 100)}%`); return new Promise((r) => setTimeout(r)); },
        });
        const four = Object.assign(document.createElement("canvas"), { width: big.width, height: big.height });
        four.getContext("2d").putImageData(new ImageData(big.data, big.width, big.height), 0, 0);
        // 2×: the model always makes 4×, so that's brought down smoothly, which also keeps it crisp
        canvas = factor === 4 ? four : drawn(four, W * 2, H * 2);
      }
      // the comparison: the plain enlargement a browser would do, against the result
      const before = viewer.querySelector(".cv-before"), after = viewer.querySelector(".cv-after");
      for (const c of [before, after]) Object.assign(c, { width: canvas.width, height: canvas.height });
      before.getContext("2d").drawImage(drawn(bitmap, canvas.width, canvas.height), 0, 0);
      after.getContext("2d").drawImage(canvas, 0, 0);
      viewer.hidden = false;
      const frame = viewer.querySelector(".cv-frame");
      frame.scrollLeft = (canvas.width - frame.clientWidth) / 2;
      frame.scrollTop = (canvas.height - frame.clientHeight) / 2;
      result = { canvas, factor };
      save.hidden = false;
      status(out, `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${canvas.width} × ${canvas.height}. Compare, then save.`, "good");
    }));

    save.addEventListener("click", () => busy(save, out, "Saving...", async () => {
      const type = val("type");
      const blob = await toBlob(type === "image/jpeg" ? drawn(result.canvas, result.canvas.width, result.canvas.height, { background: "#fff" }) : result.canvas, type, 0.92);
      download(blob, renamed(file, `-${result.factor}x`, type === "image/png" ? "png" : "jpg"));
      status(out, `Saved: ${result.canvas.width} × ${result.canvas.height}, ${bytes(blob.size)}.`, "good");
    }));
  } });
}
