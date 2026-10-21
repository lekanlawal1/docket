import { onePdf, download, renamed, bytes, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, rasterize } from "../pdf.js";
import { shrinkImages } from "../shrink.js";

export const intro = "Shrink a PDF for email or an upload limit. The pictures inside get smaller; the text stays sharp and selectable.";

const LEVELS = {
  tidy: { label: "Tidy up", note: "Repacks the file without touching anything on the pages. Small savings, nothing lost." },
  light: { label: "Smaller", maxSide: 2000, quality: 0.75, note: "Pictures are saved at good quality, up to 2000 pixels across. Text isn't touched." },
  strong: { label: "Much smaller", maxSide: 1400, quality: 0.6, note: "Pictures are fine on screen, a little soft in print. Text isn't touched." },
  smallest: { label: "Smallest", maxSide: 1000, quality: 0.45, note: "Pictures get noticeably softer. Text isn't touched." },
  flatten: { label: "Flatten (last resort)", scale: 1, quality: 0.4, note: "Every page becomes one low-quality picture. Use this only if the others aren't enough: text can't be selected or searched afterwards." },
};

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>How small</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    desk.innerHTML = `<h2>How small</h2><p>Now ${bytes(file.size)}.</p>
      ${Object.entries(LEVELS).map(([k, l]) => `<label class="check"><input type="radio" name="level" value="${k}" ${k === "strong" ? "checked" : ""}> ${l.label}</label>`).join("")}
      <p class="honest level-note"></p>
      <button type="button" class="pill go">Compress</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status"), note = desk.querySelector(".level-note");
    const level = () => desk.querySelector("[name=level]:checked").value;
    const explain = () => { note.textContent = LEVELS[level()].note; };
    desk.addEventListener("change", explain);
    explain();

    go.addEventListener("click", () => busy(go, out, "Compressing...", async () => {
      const k = level(), l = LEVELS[k];
      let data, found = null;
      if (k === "flatten") {
        data = await rasterize(bytesIn, { scale: l.scale, quality: l.quality, onPage: (i, n) => status(out, `Page ${i} of ${n}...`) });
      } else {
        const doc = await openForEdit(bytesIn);
        if (k !== "tidy") found = await shrinkImages(doc, l, (i, n) => status(out, `Picture ${i} of ${n}...`));
        data = await doc.save({ useObjectStreams: true });
      }
      const saved = 1 - data.length / bytesIn.length;
      if (saved <= 0.02) {
        const why = found && !found.shrunk
          ? found.images ? "Its pictures are already small or in a format this can't shrink safely." : "It has no pictures to shrink; it's mostly text, which is already compact."
          : "This file is already small for what's in it.";
        status(out, `That didn't help: the result would be ${bytes(data.length)}, no smaller than the original. ${why}${k !== "flatten" ? " Flatten is the last resort." : ""}`, "bad");
        return;
      }
      download(data, renamed(file, "-compressed", "pdf"));
      status(out, `Done: ${bytes(bytesIn.length)} → ${bytes(data.length)}, ${saved > 0.99 ? "over 99" : Math.round(saved * 100)}% smaller` +
        (found?.shrunk ? `. ${plural(found.shrunk, "picture")} made smaller; text untouched.` : "."), "good");
    }));
  } });
}
