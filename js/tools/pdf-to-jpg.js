import { onePdf, download, renamed, plural, busy, status, bytes } from "../ui.js";
import { readBytes, openForView, drawPage, canvasBlob } from "../pdf.js";
import { parseRanges } from "../ranges.js";
import { zip } from "../zip.js";

export const intro = "Turn pages into pictures for slides, social posts or a quick preview.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Images</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const view = await openForView(await readBytes(file));
    const count = view.numPages;
    const { canvas } = await drawPage(view, 1, { width: 280 });
    canvas.style.cssText = "max-width: 280px; box-shadow: 0 1px 6px rgba(0,0,0,.2); border-radius: 4px";
    main.append(canvas);

    desk.innerHTML = `<h2>Images</h2><p>${plural(count, "page")}.</p>
      <label class="field">Pages<input type="text" name="pages" value="1-${count}"></label>
      <label class="field">Sharpness
        <select name="scale"><option value="1">Screen (72 dpi)</option><option value="2" selected>Sharp (144 dpi)</option><option value="4">Print (288 dpi)</option></select></label>
      <label class="field">Format
        <select name="type"><option value="image/jpeg">JPG (smaller)</option><option value="image/png">PNG (crisp text)</option></select></label>
      <button type="button" class="pill go">Make images</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector("button"), out = desk.querySelector(".status");

    go.addEventListener("click", () => busy(go, out, "Drawing pages...", async () => {
      const pages = parseRanges(desk.querySelector("[name=pages]").value, count).flat();
      const scale = Number(desk.querySelector("[name=scale]").value);
      const type = desk.querySelector("[name=type]").value, ext = type === "image/png" ? "png" : "jpg";
      const images = [];
      for (const [k, p] of pages.entries()) {
        status(out, `Page ${k + 1} of ${pages.length}...`);
        const { canvas } = await drawPage(view, p + 1, { scale });
        const blob = await canvasBlob(canvas, type, 0.9);
        images.push({ name: renamed(file, `-page-${String(p + 1).padStart(String(count).length, "0")}`, ext), data: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (images.length === 1) download(images[0].data, images[0].name, type);
      else download(zip(images), renamed(file, "-images", "zip"), "application/zip");
      const total = images.reduce((n, x) => n + x.data.length, 0);
      status(out, `Done: ${plural(images.length, "image")}, ${bytes(total)}${images.length > 1 ? ", in one .zip" : ""}.`, "good");
    }));
  } });
}
