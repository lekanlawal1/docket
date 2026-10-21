import { onePdf, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, openForView, viewports, uprightPoint, lib } from "../pdf.js";

export const intro = "Stamp a word like DRAFT or CONFIDENTIAL across every page.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Watermark</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const view = await openForView(bytesIn);
    main.insertAdjacentHTML("beforeend", `<p>${plural(view.numPages, "page")}.</p>`);

    desk.innerHTML = `<h2>Watermark</h2>
      <label class="field">Text<input type="text" name="text" value="DRAFT" maxlength="40"></label>
      <label class="field">Angle<select name="angle"><option value="45">Diagonal</option><option value="0">Straight across</option></select></label>
      <label class="field">How strong<input type="range" name="opacity" min="5" max="60" value="18"></label>
      <label class="field">Colour<select name="color"><option value="0.45,0.45,0.45">Grey</option><option value="0.7,0.15,0.1">Red</option><option value="0.15,0.3,0.55">Blue</option></select></label>
      <button type="button" class="pill go">Add watermark</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const val = (n) => desk.querySelector(`[name=${n}]`).value;

    go.addEventListener("click", () => busy(go, out, "Stamping...", async () => {
      const text = val("text").trim();
      if (!text) throw new Error("Type the watermark text first.");
      const { StandardFonts, rgb, degrees } = await lib();
      const doc = await openForEdit(bytesIn);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const vps = await viewports(view);
      const angle = Number(val("angle")), [r, g, b] = val("color").split(",").map(Number);
      doc.getPages().forEach((page, i) => {
        const vp = vps[i];
        // as big as fits across the page (the diagonal for a slanted stamp)
        const room = angle ? Math.hypot(vp.width, vp.height) * 0.7 : vp.width * 0.8;
        const size = Math.min(140, room / font.widthOfTextAtSize(text, 1));
        const tw = font.widthOfTextAtSize(text, size), th = font.heightAtSize(size) * 0.7;
        // start point so the text's middle lands on the page's middle, in the view's own terms
        const rad = (angle * Math.PI) / 180;
        const sx = vp.width / 2 - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * th) / 2;
        const sy = vp.height / 2 + (Math.sin(rad) * tw) / 2 + (Math.cos(rad) * th) / 2;
        const at = uprightPoint(vp, sx / vp.width, sy / vp.height);
        page.drawText(text, { x: at.x, y: at.y, size, font, color: rgb(r, g, b), opacity: Number(val("opacity")) / 100, rotate: degrees(at.rotate + angle) });
      });
      download(await doc.save(), renamed(file, "-watermarked", "pdf"));
      status(out, `Done: ${plural(doc.getPageCount(), "page")} stamped.`, "good");
    }));
  } });
}
