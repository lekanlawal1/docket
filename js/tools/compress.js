import { onePdf, download, renamed, bytes, busy, status } from "../ui.js";
import { readBytes, openForEdit, rasterize } from "../pdf.js";

export const intro = "Shrink a PDF for email or an upload limit. Scanned and photo-heavy files shrink the most.";

const LEVELS = {
  tidy: { label: "Tidy up (keeps text)", note: "Repacks the file without touching what's on the pages. Small savings, nothing lost." },
  light: { label: "Smaller", scale: 1.6, quality: 0.72, note: "Pages become images at good quality." },
  strong: { label: "Much smaller", scale: 1.25, quality: 0.55, note: "Pages become images; fine for reading on screen." },
  smallest: { label: "Smallest", scale: 1, quality: 0.4, note: "Pages become low-quality images. For tight limits only." },
};

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>How small</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    desk.innerHTML = `<h2>How small</h2><p>Now ${bytes(file.size)}.</p>
      ${Object.entries(LEVELS).map(([k, l], i) => `<label class="check"><input type="radio" name="level" value="${k}" ${i === 2 ? "checked" : ""}> ${l.label}</label>`).join("")}
      <p class="honest level-note"></p>
      <button type="button" class="pill go">Compress</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), note = desk.querySelector(".level-note");
    const level = () => desk.querySelector("[name=level]:checked").value;
    const explain = () => {
      const k = level();
      note.textContent = LEVELS[k].note + (k === "tidy" ? "" : " Text on them can't be selected or searched afterwards.");
    };
    desk.addEventListener("change", explain);
    explain();

    go.addEventListener("click", () => busy(go, out, "Compressing...", async () => {
      const k = level(), l = LEVELS[k];
      let data;
      if (k === "tidy") data = await (await openForEdit(bytesIn)).save({ useObjectStreams: true });
      else data = await rasterize(bytesIn, { scale: l.scale, quality: l.quality, onPage: (i, n) => status(out, `Page ${i} of ${n}...`) });
      const saved = 1 - data.length / bytesIn.length;
      if (saved <= 0.02) {
        status(out, `That didn't help: the result would be ${bytes(data.length)}, no smaller than the original. ${k === "tidy" ? "Try a stronger level." : "This file is already small for what's in it."}`, "bad");
        return;
      }
      download(data, renamed(file, "-compressed", "pdf"));
      status(out, `Done: ${bytes(bytesIn.length)} → ${bytes(data.length)}, ${Math.round(saved * 100)}% smaller.`, "good");
    }));
  } });
}
