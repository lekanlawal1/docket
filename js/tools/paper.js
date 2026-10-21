import { download, busy, status } from "../ui.js";
import { lib } from "../pdf.js";

export const intro = "Lined, grid or dot paper as a PDF, to print or to write on in a tablet app.";

const SIZES = { letter: [612, 792], a4: [595.28, 841.89] };
const MM = 72 / 25.4;          // points in a millimetre
const SPACING = { narrow: 6, normal: 7.1, wide: 8.7 }; // mm: college ruled, ~9/32", wide ruled

export function mount({ main, desk, privateNote }) {
  main.innerHTML = `<canvas class="sheet" aria-label="Preview of the paper"></canvas>`;
  desk.innerHTML = `<h2>Paper</h2>
    <label class="field">Style<select name="style"><option value="lined">Lined</option><option value="grid">Grid</option><option value="dots">Dots</option></select></label>
    <label class="field">Spacing<select name="spacing"><option value="narrow">Narrow (6 mm)</option><option value="normal" selected>Regular (7 mm)</option><option value="wide">Wide (8.7 mm)</option></select></label>
    <label class="field">Page size<select name="size"><option value="letter">Letter</option><option value="a4">A4</option></select></label>
    <label class="field">Pages<input type="number" name="pages" min="1" max="200" value="10"></label>
    <label class="check"><input type="checkbox" name="margin" checked> Margin line (lined only)</label>
    <button type="button" class="pill go">Make paper</button>
    <p class="status" role="status"></p>${privateNote().replace("Your files stay on this device. Nothing is uploaded.", "Made on this device.")}`;
  const q = (n) => desk.querySelector(`[name=${n}]`);
  const go = desk.querySelector(".go"), out = desk.querySelector(".status");
  const pad = main.querySelector("canvas");

  const settings = () => ({ style: q("style").value, gap: SPACING[q("spacing").value] * MM, size: SIZES[q("size").value], margin: q("margin").checked });

  // Calls line(x1, y1, x2, y2) and dot(x, y) in page points, top-left origin. Both the
  // preview and the PDF use this, so they can't disagree.
  function lay({ style, gap, size: [w, hgt], margin }, line, dot) {
    const edge = 36;
    if (style === "lined") {
      for (let y = edge + gap * 2; y <= hgt - edge; y += gap) line(edge, y, w - edge, y, "rule");
      if (margin) line(edge + 54, edge, edge + 54, hgt - edge, "margin");
    } else {
      const cols = Math.floor((w - edge * 2) / gap), rows = Math.floor((hgt - edge * 2) / gap);
      const x0 = (w - cols * gap) / 2, y0 = (hgt - rows * gap) / 2;
      if (style === "grid") {
        for (let i = 0; i <= cols; i++) line(x0 + i * gap, y0, x0 + i * gap, y0 + rows * gap, "rule");
        for (let j = 0; j <= rows; j++) line(x0, y0 + j * gap, x0 + cols * gap, y0 + j * gap, "rule");
      } else {
        for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) dot(x0 + i * gap, y0 + j * gap);
      }
    }
  }

  function draw() {
    const s = settings(), [w, hgt] = s.size, k = 2;
    pad.width = w * k; pad.height = hgt * k;
    pad.style.aspectRatio = `${w} / ${hgt}`;
    const ctx = pad.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pad.width, pad.height);
    lay(s, (x1, y1, x2, y2, kind) => {
      ctx.strokeStyle = kind === "margin" ? "#e3a3a3" : "#b9c6d3";
      ctx.lineWidth = k * 0.6;
      ctx.beginPath(); ctx.moveTo(x1 * k, y1 * k); ctx.lineTo(x2 * k, y2 * k); ctx.stroke();
    }, (x, y) => { ctx.fillStyle = "#8f9fae"; ctx.beginPath(); ctx.arc(x * k, y * k, k * 0.9, 0, Math.PI * 2); ctx.fill(); });
  }
  desk.addEventListener("change", draw);
  draw();

  go.addEventListener("click", () => busy(go, out, "Making...", async () => {
    const pages = Math.round(+q("pages").value);
    if (!(pages >= 1 && pages <= 200)) throw new Error("choose between 1 and 200 pages.");
    const { PDFDocument, rgb } = await lib();
    const doc = await PDFDocument.create();
    doc.setTitle(`${q("style").value[0].toUpperCase()}${q("style").value.slice(1)} paper`);
    doc.setProducer("Docket");
    doc.setCreator("Docket");
    const s = settings(), [w, hgt] = s.size;
    const rule = rgb(0.725, 0.776, 0.827), red = rgb(0.89, 0.64, 0.64), dotColour = rgb(0.56, 0.62, 0.68);
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([w, hgt]);
      // pdf-lib measures from the bottom; lay() from the top
      lay(s, (x1, y1, x2, y2, kind) => page.drawLine({ start: { x: x1, y: hgt - y1 }, end: { x: x2, y: hgt - y2 }, thickness: 0.6, color: kind === "margin" ? red : rule }),
        (x, y) => page.drawCircle({ x, y: hgt - y, size: 0.9, color: dotColour }));
    }
    download(await doc.save(), `${q("style").value}-paper-${q("size").value}.pdf`);
    status(out, `Done: ${pages} ${pages === 1 ? "page" : "pages"}.`, "good");
  }));
}
