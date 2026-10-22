// Small DOM helpers shared by every tool. No framework: each tool builds its own bit of page.

import { svg } from "./icons.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

// A drop zone styled as a bit of dock. `onFiles` gets an array of File.
export function dock({ accept = "", multiple = false, title = "Drop files on the dock", hint = "", small = false, onFiles }) {
  const el = h(`<label class="dock${small ? " small" : ""}">
    <input type="file" ${accept ? `accept="${esc(accept)}"` : ""} ${multiple ? "multiple" : ""}>
    ${small ? svg("plus", { size: 20 }) : `<svg class="art" width="46" height="46" viewBox="0 0 46 46" stroke-width="1.6" aria-hidden="true"><path d="M14 30h18l-3 6H17zM23 8v18M17 14l6-6 6 6"/></svg>`}
    <span class="title">${esc(title)}</span>
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}
    ${small ? "" : `<span class="pill">Choose ${multiple ? "files" : "a file"}</span>`}
  </label>`);
  const input = el.querySelector("input");
  const take = (list) => { const files = [...list]; if (files.length) onFiles(multiple ? files : files.slice(0, 1)); };
  input.addEventListener("change", () => { take(input.files); input.value = ""; });
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("over"); take(e.dataTransfer.files); });
  return el;
}

export function download(data, name, type = "application/pdf") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// "Report.pdf" + "-merged" -> "Report-merged.pdf"
export function renamed(file, suffix, ext) {
  const base = (file?.name || "document").replace(/\.[^.]+$/, "");
  return `${base}${suffix}.${ext || (file?.name.split(".").pop() || "pdf")}`;
}

export function status(el, msg = "", kind = "") {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

export const privateNote = () => `<p class="private-note">${svg("lock", { size: 16 })}<span>Your files stay on this device. Nothing is uploaded.</span></p>`;

// Runs a slow job with the button disabled and errors shown in plain words.
export async function busy(button, statusEl, label, job) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = label;
  status(statusEl, "");
  try {
    await job();
  } catch (err) {
    console.error(err);
    status(statusEl, friendly(err), "bad");
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

export function friendly(err) {
  const m = String(err?.message || err);
  if (/couldn't be read from your disk/.test(m)) return m;
  if (/encrypt|password/i.test(m)) return "This PDF is password-protected. Unlock it with the Password tool first, then try again.";
  if (/Invalid PDF|No PDF header|parse/i.test(m)) return "That file doesn't look like a working PDF. Try opening it and saving a fresh copy.";
  return "Something went wrong: " + m;
}

// The usual start for a one-PDF tool: a dock, then a bar naming the loaded file with a way
// to swap it. `onLoad(file)` builds the rest; it gets called again if the file is swapped.
export function onePdf(main, { files = [], title = "Drop a PDF here", hint = "", onLoad }) {
  const start = () => {
    main.innerHTML = "";
    main.append(dock({ accept: ".pdf,application/pdf", title, hint, onFiles: ([f]) => open(f) }));
  };
  const open = (file) => {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      start();
      main.append(h(`<p class="status bad">${esc(file.name)} isn't a PDF.</p>`));
      return;
    }
    main.innerHTML = "";
    const bar = h(`<div class="result" style="margin-bottom: 16px"><span><b>${esc(file.name)}</b> <small style="color: var(--muted)">${bytes(file.size)}</small></span>
      <button type="button" class="pill ghost">Use a different file</button></div>`);
    bar.querySelector("button").addEventListener("click", start);
    main.append(bar);
    onLoad(file);
  };
  const first = files.find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  first ? open(first) : start();
}

// A row of page thumbnails. `card(i, canvas)` returns the element for page i (0-based).
export async function thumbnails(container, viewDoc, card, width = 150) {
  const { drawPage } = await import("./pdf.js");
  for (let i = 0; i < viewDoc.numPages; i++) {
    const { canvas } = await drawPage(viewDoc, i + 1, { width });
    container.append(card(i, canvas));
  }
}
