import { onePdf, download, renamed, plural, bytes, busy, status } from "../ui.js";
import { readBytes, openForView, rasterize } from "../pdf.js";

export const intro = "Take the colour out, to save ink or meet a black-and-white requirement.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Grayscale</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    const pages = view.numPages;
    await view.destroy();
    desk.innerHTML = `<h2>Grayscale</h2><p>${plural(pages, "page")}.</p>
      <p class="honest">Pages are redrawn in grey as images, so their text can't be selected afterwards.</p>
      <button type="button" class="pill go">Make it grayscale</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    go.addEventListener("click", () => busy(go, out, "Working...", async () => {
      const data = await rasterize(bytesIn, { gray: true, scale: 2, quality: 0.85, onPage: (i, n) => status(out, `Page ${i} of ${n}...`) });
      download(data, renamed(file, "-grayscale", "pdf"));
      status(out, `Done: ${plural(pages, "page")}, ${bytes(data.length)}.`, "good");
    }));
  } });
}
