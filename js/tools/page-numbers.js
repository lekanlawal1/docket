import { onePdf, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, openForView, viewports, uprightPoint, lib } from "../pdf.js";

export const intro = "Number the pages, in the corner you choose and the style you like.";

const STYLES = {
  plain: (n) => `${n}`,
  page: (n) => `Page ${n}`,
  of: (n, total) => `Page ${n} of ${total}`,
  slash: (n, total) => `${n} / ${total}`,
};

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Numbers</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    main.insertAdjacentHTML("beforeend", `<p>${plural(view.numPages, "page")}.</p>`);

    desk.innerHTML = `<h2>Numbers</h2>
      <label class="field">Where<select name="where">
        <option value="bottom-center">Bottom, centre</option><option value="bottom-right">Bottom, right</option><option value="bottom-left">Bottom, left</option>
        <option value="top-right">Top, right</option><option value="top-center">Top, centre</option></select></label>
      <label class="field">Style<select name="style">
        <option value="plain">1</option><option value="page">Page 1</option><option value="of">Page 1 of ${view.numPages}</option><option value="slash">1 / ${view.numPages}</option></select></label>
      <label class="field">Start counting at<input type="number" name="start" value="1" min="0"></label>
      <label class="check"><input type="checkbox" name="skip"> Leave the first page blank (a cover)</label>
      <label class="field">Size<input type="number" name="size" value="10" min="6" max="24"></label>
      <button type="button" class="pill go">Add numbers</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const val = (n) => desk.querySelector(`[name=${n}]`);

    go.addEventListener("click", () => busy(go, out, "Numbering...", async () => {
      const { StandardFonts, rgb, degrees } = await lib();
      const doc = await openForEdit(bytesIn);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const vps = await viewports(view);
      const [v, hz] = val("where").value.split("-");
      const size = Number(val("size").value), skip = val("skip").checked;
      const total = doc.getPageCount() - (skip ? 1 : 0);
      let n = Number(val("start").value);
      doc.getPages().forEach((page, i) => {
        if (skip && i === 0) return;
        const label = STYLES[val("style").value](n, total + Number(val("start").value) - 1);
        n += 1;
        const vp = vps[i];
        const tw = font.widthOfTextAtSize(label, size) / vp.width;    // as a fraction of the page width
        const margin = 28 / vp.width, fx = hz === "left" ? margin : hz === "right" ? 1 - margin - tw : 0.5 - tw / 2;
        const fy = v === "top" ? 30 / vp.height : 1 - 24 / vp.height;
        const at = uprightPoint(vp, fx, fy);
        page.drawText(label, { x: at.x, y: at.y, size, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(at.rotate) });
      });
      download(await doc.save(), renamed(file, "-numbered", "pdf"));
      status(out, `Done: ${plural(total, "page")} numbered.`, "good");
    }));
  } });
}
