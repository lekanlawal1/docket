import { onePdf, h, esc, download, renamed, plural, busy, status } from "../ui.js";
import { readBytes, openForEdit, lib } from "../pdf.js";
import { flatForm } from "./fill-flat.js";

export const intro = "Type into a form and save it. Forms with fillable boxes are listed to fill in; a scan, photo or flat PDF works too: Docket finds the blanks and tick boxes on the page for you.";

export function mount({ main, desk, files, privateNote }) {
  desk.innerHTML = `<h2>Save</h2><p>Load a PDF to begin.</p>`;

  onePdf(main, { files, onLoad: async (file) => {
    const bytesIn = await readBytes(file);
    let doc;
    try { doc = await openForEdit(bytesIn); }
    catch (err) { main.append(h(`<p class="status bad">${esc(err.message)}</p>`)); return; }
    const fields = doc.getForm().getFields();
    if (!fields.length) {
      // a flat form: find where to write on the page itself
      try { await flatForm({ main, desk, file, bytesIn, privateNote }); }
      catch (err) { main.append(h(`<p class="status bad">${esc(err.message)}</p>`)); }
      return;
    }

    const form = h(`<form class="desk" style="background: var(--card); border: 1px solid var(--card-line)"></form>`);
    // class names don't survive minifying, so check field types against the classes themselves
    const { PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = await lib();
    const kind = (f) => f instanceof PDFTextField ? "text" : f instanceof PDFCheckBox ? "check"
      : f instanceof PDFDropdown || f instanceof PDFOptionList ? "list" : f instanceof PDFRadioGroup ? "radio" : "other";
    fields.forEach((f, i) => {
      const label = esc(f.getName().replace(/[._]+/g, " ").replace(/\s+/g, " ").trim());
      const id = `f${i}`;
      let input = "";
      if (kind(f) === "text") input = `<input type="text" id="${id}" value="${esc(f.getText() || "")}">`;
      else if (kind(f) === "check") { form.append(h(`<label class="check"><input type="checkbox" id="${id}" ${f.isChecked() ? "checked" : ""}> ${label}</label>`)); return; }
      else if (kind(f) === "list") {
        const now = f.getSelected()[0];
        input = `<select id="${id}"><option value=""></option>${f.getOptions().map((o) => `<option ${o === now ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      } else if (kind(f) === "radio") {
        const now = f.getSelected();
        input = `<select id="${id}"><option value=""></option>${f.getOptions().map((o) => `<option ${o === now ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      } else return;                                   // buttons and signature fields
      form.append(h(`<label class="field" for="${id}">${label}${input}</label>`));
    });
    main.append(form);

    desk.innerHTML = `<h2>Save</h2><p>${plural(fields.length, "field")} found.</p>
      <label class="check"><input type="checkbox" name="flatten"> Lock the answers in (can't be edited after)</label>
      <button type="button" class="pill go">Save filled PDF</button>
      <p class="status" role="status"></p>${privateNote()}`;
    const go = desk.querySelector(".go"), out = desk.querySelector(".status");

    go.addEventListener("click", () => busy(go, out, "Saving...", async () => {
      const fresh = await openForEdit(bytesIn);
      const f2 = fresh.getForm();
      f2.getFields().forEach((f, i) => {
        const el = form.querySelector(`#f${i}`);
        if (!el) return;
        const k = kind(f);
        if (k === "text") f.setText(el.value);
        else if (k === "check") (el.checked ? f.check() : f.uncheck());
        else if (el.value && (k === "list" || k === "radio")) f.select(el.value);
      });
      if (desk.querySelector("[name=flatten]").checked) f2.flatten();
      download(await fresh.save(), renamed(file, "-filled", "pdf"));
      status(out, "Done.", "good");
    }));
  } });
}
