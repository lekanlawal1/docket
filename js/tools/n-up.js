import { onePdf, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, lib } from "../pdf.js";

export const intro = "Two, four or six pages on each sheet, for handouts, proofreading or saving paper.";

const SHEETS = { letter: [612, 792], a4: [595.28, 841.89] };
// columns × rows, and whether the sheet turns sideways to fit them best
const LAYOUTS = { 2: { cols: 2, rows: 1, landscape: true }, 4: { cols: 2, rows: 2, landscape: false }, 6: { cols: 2, rows: 3, landscape: false } };
const MARGIN = 24, GAP = 12;

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Pages per sheet</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    const src = await openForEdit(bytesIn);
    const count = src.getPageCount();

    desk.innerHTML = `<h2>Pages per sheet</h2><p>${plural(count, "page")}.</p>
      <label class="field">Per sheet<select name="per"><option value="2">2 (side by side)</option><option value="4" selected>4</option><option value="6">6</option></select></label>
      <label class="field">Sheet size<select name="size"><option value="letter">Letter</option><option value="a4">A4</option></select></label>
      <label class="check"><input type="checkbox" name="border" checked> Thin line around each page</label>
      <p class="sheets-line" style="font-size: 14px"></p>
      <button type="button" class="pill go">Make sheets</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");
    const val = (n) => desk.querySelector(`[name=${n}]`);
    const refresh = () => { desk.querySelector(".sheets-line").textContent = `That makes ${plural(Math.ceil(count / Number(val("per").value)), "sheet")}.`; };
    desk.addEventListener("change", refresh);
    refresh();

    go.addEventListener("click", () => busy(go, out, "Arranging...", async () => {
      const { PDFDocument, degrees, rgb } = await lib();
      const per = Number(val("per").value), { cols, rows, landscape } = LAYOUTS[per];
      let [sw, sh] = SHEETS[val("size").value];
      if (landscape) [sw, sh] = [sh, sw];
      const doc = await PDFDocument.create();
      const fresh = await openForEdit(bytesIn);
      const embedded = await doc.embedPages(fresh.getPages());
      const cellW = (sw - MARGIN * 2 - GAP * (cols - 1)) / cols, cellH = (sh - MARGIN * 2 - GAP * (rows - 1)) / rows;

      for (let start = 0; start < count; start += per) {
        const sheet = doc.addPage([sw, sh]);
        for (let k = 0; k < per && start + k < count; k++) {
          const i = start + k, emb = embedded[i];
          const rot = ((fresh.getPage(i).getRotation().angle % 360) + 360) % 360;
          // a page with /Rotate set is drawn turned, so it sits upright as people see it
          const side = rot % 180 !== 0;
          const w = side ? emb.height : emb.width, hgt = side ? emb.width : emb.height;
          const s = Math.min(cellW / w, cellH / hgt);
          const col = k % cols, row = Math.floor(k / cols);
          const cx = MARGIN + col * (cellW + GAP) + (cellW - w * s) / 2;
          const cy = sh - MARGIN - (row + 1) * cellH - row * GAP + (cellH - hgt * s) / 2;
          // where the page's own corner lands once it's turned
          const at = { 0: [cx, cy], 90: [cx, cy + emb.width * s], 180: [cx + emb.width * s, cy + emb.height * s], 270: [cx + emb.height * s, cy] }[rot];
          sheet.drawPage(emb, { x: at[0], y: at[1], xScale: s, yScale: s, rotate: degrees(-rot) });
          if (val("border").checked) sheet.drawRectangle({ x: cx, y: cy, width: w * s, height: hgt * s, borderColor: rgb(0.7, 0.72, 0.75), borderWidth: 0.6 });
        }
      }
      download(await doc.save(), renamed(file, `-${per}-per-sheet`, "pdf"));
      status(out, `Done: ${plural(count, "page")} on ${plural(doc.getPageCount(), "sheet")}.`, "good");
    }));
  } });
}
