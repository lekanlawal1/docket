import { onePdf, h, esc, download, renamed, plural, bytes, busy, status } from "../ui.js";
import { readBytes, openForView, viewer } from "../pdf.js";
import { pagePictures } from "../pictures.js";
import { crc32, zip } from "../zip.js";

export const intro = "Every picture inside a PDF, saved as its own image file at its full size.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Images</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const view = await openForView(await readBytes(file));
    const pdfjs = await viewer();
    desk.innerHTML = `<h2>Images</h2><p class="summary-line">Looking through the pages...</p>`;
    const line = desk.querySelector(".summary-line");

    // every picture drawn, then each distinct one kept once (a logo on every page is one image)
    const found = [], seen = new Map();
    for (let n = 1; n <= view.numPages; n++) {
      line.textContent = `Looking through page ${n} of ${view.numPages}...`;
      const page = await view.getPage(n);
      const pics = await pagePictures(page, await page.getOperatorList(), pdfjs, page.getViewport({ scale: 1 }).transform);
      for (const p of pics) {
        const key = `${crc32(p.data)}:${p.data.length}`;
        if (seen.has(key)) { seen.get(key).pages.add(n); continue; }
        const img = { ...p, pages: new Set([n]), px: await dims(p) };
        seen.set(key, img);
        found.push(img);
      }
    }

    desk.innerHTML = `<h2>Images</h2><p class="summary-line"></p>
      <label class="check"><input type="checkbox" name="small" checked> Skip small ones (icons and bullets under 100 pixels)</label>
      <button type="button" class="pill go">Save images</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">Pictures are saved at the size they're stored in the PDF, as JPG (photos) or PNG (anything with see-through parts or sharp edges). Charts and drawings made of lines aren't pictures, so they aren't included; use <a href="#/pdf-to-jpg">PDF to JPG</a> for those.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const summary = desk.querySelector(".summary-line");
    const grid = h(`<div class="image-grid"></div>`);
    main.append(grid);
    const urls = [];
    addEventListener("hashchange", () => urls.forEach(URL.revokeObjectURL), { once: true });

    const chosen = () => found.filter((f) => !desk.querySelector("[name=small]").checked || Math.max(f.px.w, f.px.h) >= 100);
    function draw() {
      const list = chosen();
      grid.innerHTML = "";
      for (const f of list) {
        const url = URL.createObjectURL(new Blob([f.data], { type: `image/${f.ext}` }));
        urls.push(url);
        grid.append(h(`<figure><img src="${url}" alt="Image from page ${[...f.pages][0]}"><figcaption>${f.px.w} × ${f.px.h} · ${f.ext.toUpperCase()} · ${bytes(f.data.length)}<br>page ${esc([...f.pages].join(", "))}</figcaption></figure>`));
      }
      summary.textContent = found.length
        ? `${plural(list.length, "image")}${list.length < found.length ? ` (${found.length - list.length} small ones hidden)` : ""}.`
        : "No pictures in this PDF. If it's a scan, each page is one picture: PDF to JPG saves those.";
      go.disabled = !list.length;
    }
    desk.querySelector("[name=small]").onchange = draw;
    draw();

    go.addEventListener("click", () => busy(go, out, "Saving...", async () => {
      const list = chosen();
      const name = (f, k) => `page-${[...f.pages][0]}-image-${k + 1}.${f.ext === "jpeg" ? "jpg" : f.ext}`;
      if (list.length === 1) download(new Blob([list[0].data], { type: `image/${list[0].ext}` }), renamed(file, "-image", list[0].ext === "jpeg" ? "jpg" : "png"));
      else download(zip(list.map((f, k) => ({ name: name(f, k), data: f.data }))), renamed(file, "-images", "zip"), "application/zip");
      status(out, `Done: ${plural(list.length, "image")}.`, "good");
    }));
  } });
}

// pixel size of an encoded picture
async function dims(p) {
  const bmp = await createImageBitmap(new Blob([p.data], { type: `image/${p.ext}` }));
  const d = { w: bmp.width, h: bmp.height };
  bmp.close?.();
  return d;
}
