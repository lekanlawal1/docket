import { onePdf, h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, openForView, rasterize } from "../pdf.js";
import { survey, flattenDoc } from "../flatten.js";

export const intro = "Locks form answers, comments, highlights, stamps and drawings into the page, so they look the same in every app and can't be changed or lost.";

const NAMES = { Text: "sticky note", FreeText: "typed comment", Highlight: "highlight", Underline: "underline", StrikeOut: "strike-through", Squiggly: "squiggle",
  Square: "box", Circle: "circle", Line: "line", Polygon: "shape", PolyLine: "line", Ink: "drawing", Stamp: "stamp", Caret: "insert mark", FileAttachment: "attached file", Sound: "sound", Widget: "form box" };

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Flatten</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    let found;
    try { found = await survey(await openForEdit(bytesIn)); }
    catch (err) { main.append(h(`<p class="status bad">${esc(err.message)}</p>`)); return; }
    const { fields, kinds, marks, noLook } = found;
    const parts = Object.entries(kinds).map(([k, n]) => plural(n, NAMES[k] || "mark"));
    main.append(h(`<div class="desk" style="background: var(--card); border: 1px solid var(--card-line)">
      <h2 style="font-size: 20px">What will be locked in</h2>
      ${fields || marks ? `<ul style="margin: 0; padding-left: 20px">
        ${fields ? `<li>${plural(fields, "form field")}, with whatever is filled in</li>` : ""}
        ${parts.length ? `<li>${esc(parts.join(", "))}</li>` : ""}</ul>`
      : "<p style=\"margin: 0\">Nothing: this PDF has no form fields or comments. It's already flat.</p>"}
    </div>`));

    desk.innerHTML = `<h2>Flatten</h2>
      <label class="check"><input type="checkbox" name="pictures" ${noLook.length ? "checked" : ""}> Also turn pages into pictures (nothing on them can be edited or copied)</label>
      ${noLook.length ? `<p class="note">Some marks on page${noLook.length > 1 ? "s" : ""} ${esc(noLook.join(", "))} don't carry their own look, so they can only be kept by turning the page into a picture. That's switched on for you.</p>` : ""}
      <button type="button" class="pill go" ${fields || marks ? "" : "disabled"}>Flatten PDF</button>
      <p class="status" role="status"></p>
      <p class="honest" style="margin-top: 14px">Links stay clickable. Comments' pop-up notes are removed: their text isn't printed on the page in any app, so it doesn't carry over.</p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");

    go.addEventListener("click", () => busy(go, out, "Flattening...", async () => {
      let data;
      if (desk.querySelector("[name=pictures]").checked) {
        // drawn by pdf.js with the marks showing, then nothing but the pictures kept
        data = await rasterize(bytesIn, { scale: 2, quality: 0.88, onPage: (n, of) => status(out, `Drawing page ${n} of ${of}...`) });
      } else {
        const doc = await openForEdit(bytesIn);
        await flattenDoc(doc);
        data = await doc.save();
      }
      // read it back: nothing editable may be left
      const after = await survey(await openForEdit(data));
      if (after.fields || after.marks) throw new Error("some fields or marks were still editable afterwards, so nothing was downloaded.");
      const check = await openForView(data);
      const pages = check.numPages;
      await check.destroy();
      download(data, renamed(file, "-flat", "pdf"));
      status(out, `Done and checked: ${plural(pages, "page")}, nothing left to edit.`, "good");
    }));
  } });
}
